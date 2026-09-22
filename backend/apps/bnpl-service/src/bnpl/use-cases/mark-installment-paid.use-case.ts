import { InstallmentStatus, KafkaTopics } from '@bnpl/event-contracts';
import { RequestContextService } from '@bnpl/observability';
import { saveWithOutbox } from '@bnpl/outbox';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Installment } from '../entities/installment.entity';
import { PaymentEventPayload } from './payment-event-payload';
import { UseCase } from './use-case.interface';

/**
 * Reaction to `payment.installment_charge.captured.v1`: the installment's
 * charge succeeded. `orderId`/`userId` come straight from the payload
 * (payment-service always includes them on this topic) — no need to look up
 * the owning plan just to re-derive what the event already carries.
 *
 * Idempotent the same way as the other payment-event use cases: a
 * pessimistic row lock plus an early-return once the installment is no
 * longer in a chargeable state (already `PAID`, or moved on some other way
 * — e.g. the plan got cancelled by a full refund in between).
 */
@Injectable()
export class MarkInstallmentPaidUseCase implements UseCase<PaymentEventPayload, void> {
  private readonly logger = new Logger(MarkInstallmentPaidUseCase.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly requestContext: RequestContextService,
  ) {}

  async execute(payload: PaymentEventPayload): Promise<void> {
    if (!payload.installmentId) {
      this.logger.warn('payment.installment_charge.captured.v1 payload is missing installmentId, ignoring');
      return;
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const installment = await queryRunner.manager.findOne(Installment, {
        where: { id: payload.installmentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!installment) {
        this.logger.warn(`No installment found for id ${payload.installmentId}, ignoring capture event`);
        await queryRunner.rollbackTransaction();
        return;
      }
      if (installment.status !== InstallmentStatus.PENDING && installment.status !== InstallmentStatus.DUE) {
        this.logger.log(`Installment ${installment.id} is already ${installment.status}, ignoring duplicate capture event`);
        await queryRunner.rollbackTransaction();
        return;
      }

      installment.status = InstallmentStatus.PAID;
      await saveWithOutbox(queryRunner, installment, {
        eventType: KafkaTopics.bnpl.installmentPaid,
        aggregateType: 'Installment',
        aggregateId: installment.id,
        correlationId: this.requestContext.getCorrelationId() ?? 'unknown',
        transactionId: payload.orderId,
        payload: {
          installmentId: installment.id,
          orderId: payload.orderId,
          userId: payload.userId,
          amountCents: installment.amountCents,
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
