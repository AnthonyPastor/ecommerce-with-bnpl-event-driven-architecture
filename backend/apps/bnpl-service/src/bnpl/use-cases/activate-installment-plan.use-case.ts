import { randomUUID } from 'node:crypto';
import { InstallmentPlanStatus, InstallmentStatus, KafkaTopics, PaymentMethod } from '@bnpl/event-contracts';
import { RequestContextService } from '@bnpl/observability';
import { saveWithOutbox } from '@bnpl/outbox';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreditScoringService } from '../credit-scoring.service';
import { Installment } from '../entities/installment.entity';
import { InstallmentPlan } from '../entities/installment-plan.entity';
import { PaymentEventPayload } from './payment-event-payload';
import { UseCase } from './use-case.interface';

const INSTALLMENTS_COUNT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reaction to `payment.transaction.captured.v1`: the merchant has already
 * been paid in full — from this point on it's bnpl-service that charges the
 * consumer the installments separately. Real BNPL model: scoring/approval
 * happens before the charge; here we simulate it as always-approved since
 * the initial transaction was already authorized.
 *
 * Idempotent against Kafka redelivery via a Postgres advisory lock keyed on
 * `orderId` (see `PaymentsService.createPayment()` in payment-service for
 * the same pattern) — on the *first* captured-payment event for an order
 * there's no plan row yet to row-lock, so the lock has to serialize on the
 * key itself rather than on an existing row.
 */
@Injectable()
export class ActivateInstallmentPlanUseCase implements UseCase<PaymentEventPayload, void> {
  private readonly logger = new Logger(ActivateInstallmentPlanUseCase.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly creditScoring: CreditScoringService,
    private readonly requestContext: RequestContextService,
  ) {}

  async execute(payload: PaymentEventPayload): Promise<void> {
    if (payload.paymentMethod === PaymentMethod.FULL) {
      this.logger.log(`Order ${payload.orderId} was paid in full, skipping installment plan creation`);
      return;
    }

    const profile = await this.creditScoring.getOrCreateProfile(payload.userId);
    if (profile.blocked) {
      this.logger.warn(
        `User ${payload.userId} is blocked, skipping installment plan creation for order ${payload.orderId}`,
      );
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
      await queryRunner.query('SELECT pg_advisory_xact_lock(hashtext($1))', [payload.orderId]);

      const existing = await queryRunner.manager.findOne(InstallmentPlan, {
        where: { orderId: payload.orderId },
      });
      if (existing) {
        this.logger.log(`Installment plan already exists for order ${payload.orderId}, ignoring (idempotent)`);
        await queryRunner.rollbackTransaction();
        return;
      }

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
          originalAmountCents: amountCents,
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
}
