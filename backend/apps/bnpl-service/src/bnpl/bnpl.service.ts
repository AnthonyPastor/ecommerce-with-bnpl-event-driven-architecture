import { randomUUID } from 'node:crypto';
import { InstallmentPlanStatus, InstallmentStatus, KafkaTopics } from '@bnpl/event-contracts';
import { RequestContextService } from '@bnpl/observability';
import { saveWithOutbox } from '@bnpl/outbox';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CreditScoringService } from './credit-scoring.service';
import { Installment } from './entities/installment.entity';
import { InstallmentPlan } from './entities/installment-plan.entity';

const INSTALLMENTS_COUNT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PaymentEventPayload {
  transactionId: string;
  orderId: string;
  userId: string;
  amountCents: number;
  currency: string;
}

@Injectable()
export class BnplService {
  private readonly logger = new Logger(BnplService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(InstallmentPlan) private readonly plans: Repository<InstallmentPlan>,
    private readonly creditScoring: CreditScoringService,
    private readonly requestContext: RequestContextService,
  ) {}

  /**
   * Reacción a `payment.transaction.captured.v1`: el comercio ya cobró
   * completo (ver plan de arquitectura) — a partir de acá bnpl-service es
   * quien le cobra las cuotas al consumidor por separado. Modelo real de
   * BNPL: el scoring/aprobación es previo al cobro, acá lo simulamos
   * siempre-aprobando ya que la transacción inicial ya se autorizó.
   */
  async activatePlanForCapturedPayment(payload: PaymentEventPayload): Promise<void> {
    const profile = await this.creditScoring.getOrCreateProfile(payload.userId);
    if (profile.blocked) {
      this.logger.warn(
        `User ${payload.userId} is blocked, skipping installment plan creation for order ${payload.orderId}`,
      );
      return;
    }

    const existing = await this.plans.findOne({ where: { orderId: payload.orderId } });
    if (existing) {
      this.logger.log(`Installment plan already exists for order ${payload.orderId}, ignoring (idempotent)`);
      return;
    }

    await this.creditScoring.scoreUser(payload.userId);

    const perInstallment = Math.floor(payload.amountCents / INSTALLMENTS_COUNT);
    const remainder = payload.amountCents - perInstallment * INSTALLMENTS_COUNT;
    const correlationId = this.requestContext.getCorrelationId() ?? 'unknown';

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const planId = randomUUID();
      const plan = queryRunner.manager.create(InstallmentPlan, {
        id: planId,
        orderId: payload.orderId,
        userId: payload.userId,
        transactionId: payload.transactionId,
        totalCents: payload.amountCents,
        currency: payload.currency,
        installmentsCount: INSTALLMENTS_COUNT,
        status: InstallmentPlanStatus.PENDING,
      });

      await saveWithOutbox(queryRunner, plan, {
        eventType: KafkaTopics.bnpl.planCreated,
        aggregateType: 'InstallmentPlan',
        aggregateId: planId,
        correlationId,
        transactionId: payload.orderId,
        payload: {
          planId,
          orderId: payload.orderId,
          userId: payload.userId,
          totalCents: payload.amountCents,
          installmentsCount: INSTALLMENTS_COUNT,
        },
      });

      plan.status = InstallmentPlanStatus.ACTIVE;
      await saveWithOutbox(queryRunner, plan, {
        eventType: KafkaTopics.bnpl.planActivated,
        aggregateType: 'InstallmentPlan',
        aggregateId: planId,
        correlationId,
        transactionId: payload.orderId,
        payload: { planId, orderId: payload.orderId, userId: payload.userId },
      });

      const now = Date.now();
      for (let n = 1; n <= INSTALLMENTS_COUNT; n++) {
        const amountCents = n === INSTALLMENTS_COUNT ? perInstallment + remainder : perInstallment;
        const installment = queryRunner.manager.create(Installment, {
          plan,
          installmentNumber: n,
          amountCents,
          dueDate: new Date(now + n * 30 * DAY_MS),
          status: InstallmentStatus.PENDING,
          retryCount: 0,
        });
        await queryRunner.manager.save(installment);
      }

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Reacción a `payment.transaction.refunded.v1` (refund total). HOY (Fase 3)
   * nada dispara todavía este evento — payment-service no tiene el endpoint
   * de refund (eso es Fase 5) — pero el código de reacción ya queda listo.
   */
  async cancelPlanForRefund(payload: PaymentEventPayload): Promise<void> {
    const plan = await this.plans.findOne({ where: { orderId: payload.orderId }, relations: ['installments'] });
    if (!plan) {
      this.logger.warn(`No installment plan found for order ${payload.orderId}, ignoring refund event`);
      return;
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      for (const installment of plan.installments) {
        if (installment.status === InstallmentStatus.PENDING || installment.status === InstallmentStatus.DUE) {
          installment.status = InstallmentStatus.CANCELLED;
          await queryRunner.manager.save(installment);
        }
      }

      plan.status = InstallmentPlanStatus.CANCELLED;
      await saveWithOutbox(queryRunner, plan, {
        eventType: KafkaTopics.bnpl.planCancelled,
        aggregateType: 'InstallmentPlan',
        aggregateId: plan.id,
        correlationId: this.requestContext.getCorrelationId() ?? 'unknown',
        transactionId: payload.orderId,
        payload: { planId: plan.id, orderId: payload.orderId, reason: 'full_refund' },
      });

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Reacción a `payment.transaction.partially_refunded.v1`. Igual que arriba:
   * el código ya está listo, pero nada lo dispara hasta la Fase 5.
   */
  async adjustPlanForPartialRefund(payload: PaymentEventPayload): Promise<void> {
    const plan = await this.plans.findOne({ where: { orderId: payload.orderId }, relations: ['installments'] });
    if (!plan) {
      this.logger.warn(`No installment plan found for order ${payload.orderId}, ignoring partial refund event`);
      return;
    }

    const refundedCents = payload.amountCents;
    const factor = Math.max(0, (plan.totalCents - refundedCents) / plan.totalCents);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      for (const installment of plan.installments) {
        if (installment.status === InstallmentStatus.PENDING || installment.status === InstallmentStatus.DUE) {
          installment.amountCents = Math.round(installment.amountCents * factor);
          await queryRunner.manager.save(installment);
        }
      }

      const newTotalCents = plan.totalCents - refundedCents;
      plan.status = InstallmentPlanStatus.ADJUSTED;
      await saveWithOutbox(queryRunner, plan, {
        eventType: KafkaTopics.bnpl.planAdjusted,
        aggregateType: 'InstallmentPlan',
        aggregateId: plan.id,
        correlationId: this.requestContext.getCorrelationId() ?? 'unknown',
        transactionId: payload.orderId,
        payload: { planId: plan.id, orderId: payload.orderId, newTotalCents },
      });

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Reacción a `payment.transaction.chargeback_received.v1`: pausa cobros y
   * marca el perfil para re-scoring manual — no hay evento de dominio nuevo
   * para esto en el catálogo, es puramente un cambio de estado interno.
   * Igual que refund/partial-refund, nada dispara esto todavía en Fase 3.
   */
  async holdPlanForChargeback(payload: PaymentEventPayload): Promise<void> {
    const plan = await this.plans.findOne({ where: { orderId: payload.orderId } });
    if (!plan) {
      this.logger.warn(`No installment plan found for order ${payload.orderId}, ignoring chargeback event`);
      return;
    }

    plan.status = InstallmentPlanStatus.DISPUTED_HOLD;
    await this.plans.save(plan);
    await this.creditScoring.markNeedsRescoring(payload.userId);
  }

  async findPlanById(id: string): Promise<InstallmentPlan> {
    const plan = await this.plans.findOne({ where: { id }, relations: ['installments'] });
    if (!plan) {
      throw new NotFoundException(`Installment plan ${id} not found`);
    }
    return plan;
  }

  async findPlans(filter: { orderId?: string; userId?: string }): Promise<InstallmentPlan[]> {
    const where = filter.orderId ? { orderId: filter.orderId } : { userId: filter.userId };
    return this.plans.find({ where, relations: ['installments'], order: { createdAt: 'DESC' } });
  }
}
