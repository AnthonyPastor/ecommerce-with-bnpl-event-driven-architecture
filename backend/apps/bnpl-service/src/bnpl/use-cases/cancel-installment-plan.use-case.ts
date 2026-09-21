import { InstallmentPlanStatus, InstallmentStatus, KafkaTopics } from '@bnpl/event-contracts';
import { RequestContextService } from '@bnpl/observability';
import { saveWithOutbox } from '@bnpl/outbox';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Installment } from '../entities/installment.entity';
import { InstallmentPlan } from '../entities/installment-plan.entity';
import { PaymentEventPayload } from './payment-event-payload';
import { UseCase } from './use-case.interface';

/**
 * Reaction to `payment.transaction.refunded.v1` (full refund): cancels every
 * still-pending installment and marks the plan CANCELLED.
 *
 * Idempotent the same way `order-service`'s `OrdersService.markRefunded()`
 * is: a pessimistic row lock on the plan plus an early-return once its
 * status already reflects this event — a redelivered/duplicate refund event
 * is a safe no-op instead of re-emitting a second `planCancelled` event.
 */
@Injectable()
export class CancelInstallmentPlanUseCase implements UseCase<PaymentEventPayload, void> {
  private readonly logger = new Logger(CancelInstallmentPlanUseCase.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly requestContext: RequestContextService,
  ) {}

  async execute(payload: PaymentEventPayload): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const plan = await queryRunner.manager.findOne(InstallmentPlan, {
        where: { orderId: payload.orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!plan) {
        this.logger.warn(`No installment plan found for order ${payload.orderId}, ignoring refund event`);
        await queryRunner.rollbackTransaction();
        return;
      }
      if (plan.status === InstallmentPlanStatus.CANCELLED) {
        this.logger.log(`Installment plan ${plan.id} already cancelled, ignoring duplicate refund event`);
        await queryRunner.rollbackTransaction();
        return;
      }

      const installments = await queryRunner.manager.find(Installment, {
        where: { plan: { id: plan.id } },
      });

      for (const installment of installments) {
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
}
