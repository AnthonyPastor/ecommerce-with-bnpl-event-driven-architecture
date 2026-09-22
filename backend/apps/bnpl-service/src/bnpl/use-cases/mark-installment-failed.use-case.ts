import { InstallmentStatus, KafkaTopics } from '@bnpl/event-contracts';
import { RequestContextService } from '@bnpl/observability';
import { saveWithOutbox } from '@bnpl/outbox';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreditScoringService } from '../credit-scoring.service';
import { Installment } from '../entities/installment.entity';
import { PaymentEventPayload } from './payment-event-payload';
import { UseCase } from './use-case.interface';

const MAX_RETRIES = 3;
const RETRY_BACKOFF_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reaction to `payment.installment_charge.capture_failed.v1`: the
 * installment's charge attempt failed (whether it failed at the sync
 * authorize step or the async capture step — `PaymentsService.chargeInstallment()`
 * publishes this same topic for both, since from bnpl-service's side "the
 * charge didn't go through" is what matters, not which stage it failed at).
 *
 * Business-level retry, distinct from RabbitMQ's own transport-level retry
 * (`bindRetryTopology`, for transient infra failures): a declined card isn't
 * transient, so `retryCount` tracks *charge attempts*, and a failure below
 * `MAX_RETRIES` reschedules the installment (`dueDate` pushed out
 * `RETRY_BACKOFF_DAYS`, back to `PENDING` for the next poll tick to pick up)
 * rather than retrying immediately. At `MAX_RETRIES`, the installment is
 * `DEFAULTED` and the user's `CreditProfile.blocked` (future plans, not this
 * one — its other installments still collect normally, mirroring how a real
 * BNPL default blocks new credit without erasing the existing debt).
 *
 * Idempotent the same way as `MarkInstallmentPaidUseCase`.
 */
@Injectable()
export class MarkInstallmentFailedUseCase implements UseCase<PaymentEventPayload, void> {
  private readonly logger = new Logger(MarkInstallmentFailedUseCase.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly creditScoring: CreditScoringService,
    private readonly requestContext: RequestContextService,
  ) {}

  async execute(payload: PaymentEventPayload): Promise<void> {
    if (!payload.installmentId) {
      this.logger.warn('payment.installment_charge.capture_failed.v1 payload is missing installmentId, ignoring');
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
        this.logger.warn(`No installment found for id ${payload.installmentId}, ignoring capture-failed event`);
        await queryRunner.rollbackTransaction();
        return;
      }
      if (installment.status !== InstallmentStatus.PENDING && installment.status !== InstallmentStatus.DUE) {
        this.logger.log(`Installment ${installment.id} is already ${installment.status}, ignoring duplicate capture-failed event`);
        await queryRunner.rollbackTransaction();
        return;
      }

      installment.retryCount += 1;

      if (installment.retryCount >= MAX_RETRIES) {
        installment.status = InstallmentStatus.DEFAULTED;
        await saveWithOutbox(queryRunner, installment, {
          eventType: KafkaTopics.bnpl.installmentDefaulted,
          aggregateType: 'Installment',
          aggregateId: installment.id,
          correlationId: this.requestContext.getCorrelationId() ?? 'unknown',
          transactionId: payload.orderId,
          payload: {
            installmentId: installment.id,
            orderId: payload.orderId,
            userId: payload.userId,
            retryCount: installment.retryCount,
          },
        });
        await this.creditScoring.markBlocked(payload.userId, queryRunner.manager);
      } else {
        installment.status = InstallmentStatus.PENDING;
        installment.dueDate = new Date(Date.now() + RETRY_BACKOFF_DAYS * DAY_MS);
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
