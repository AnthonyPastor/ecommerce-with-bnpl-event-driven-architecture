import { InstallmentPlanStatus, InstallmentStatus, KafkaTopics } from '@bnpl/event-contracts';
import { RequestContextService } from '@bnpl/observability';
import { saveWithOutbox } from '@bnpl/outbox';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InstallmentPlan } from '../entities/installment-plan.entity';
import { PaymentEventPayload } from './payment-event-payload';
import { UseCase } from './use-case.interface';

export interface AdjustInstallmentPlanInput {
  payload: PaymentEventPayload;
  /** The `EventEnvelope.eventId` this reaction is processing — see the redelivery-guard comment below. */
  eventId: string;
}

/**
 * Reaction to `payment.transaction.partially_refunded.v1`: shrinks every
 * still-pending installment proportionally to the total refunded so far.
 *
 * `status === ADJUSTED` alone can't tell a redelivered/duplicate event apart
 * from a legitimate *second* partial refund — both leave the plan at
 * ADJUSTED — so this needs the event's own identity (`lastRefundEventId`),
 * not just a status guard like the other three reactions.
 *
 * The shrink factor is always computed from `refundedAmountCents`
 * (cumulative, persisted) against each installment's immutable
 * `originalAmountCents` — never from the already-shrunk `amountCents` — so
 * a second partial refund correctly reflects the combined total instead of
 * compounding on top of the first.
 */
@Injectable()
export class AdjustInstallmentPlanUseCase implements UseCase<AdjustInstallmentPlanInput, void> {
  private readonly logger = new Logger(AdjustInstallmentPlanUseCase.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly requestContext: RequestContextService,
  ) {}

  async execute({ payload, eventId }: AdjustInstallmentPlanInput): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const plan = await queryRunner.manager.findOne(InstallmentPlan, {
        where: { orderId: payload.orderId },
        relations: ['installments'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!plan) {
        this.logger.warn(`No installment plan found for order ${payload.orderId}, ignoring partial refund event`);
        await queryRunner.rollbackTransaction();
        return;
      }
      if (plan.lastRefundEventId === eventId) {
        this.logger.log(`Partial refund event ${eventId} already applied to plan ${plan.id}, ignoring redelivery`);
        await queryRunner.rollbackTransaction();
        return;
      }

      const newRefundedTotal = plan.refundedAmountCents + payload.amountCents;
      const factor = Math.max(0, (plan.totalCents - newRefundedTotal) / plan.totalCents);

      for (const installment of plan.installments) {
        if (installment.status === InstallmentStatus.PENDING || installment.status === InstallmentStatus.DUE) {
          installment.amountCents = Math.round(installment.originalAmountCents * factor);
          await queryRunner.manager.save(installment);
        }
      }

      plan.refundedAmountCents = newRefundedTotal;
      plan.lastRefundEventId = eventId;
      plan.status = InstallmentPlanStatus.ADJUSTED;
      await saveWithOutbox(queryRunner, plan, {
        eventType: KafkaTopics.bnpl.planAdjusted,
        aggregateType: 'InstallmentPlan',
        aggregateId: plan.id,
        correlationId: this.requestContext.getCorrelationId() ?? 'unknown',
        transactionId: payload.orderId,
        payload: {
          planId: plan.id,
          orderId: payload.orderId,
          newTotalCents: plan.totalCents - newRefundedTotal,
        },
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
