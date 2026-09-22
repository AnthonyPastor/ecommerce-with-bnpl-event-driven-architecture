import { randomUUID } from 'node:crypto';
import { InstallmentStatus, KafkaTopics, RabbitMqTopology } from '@bnpl/event-contracts';
import { RequestContextService } from '@bnpl/observability';
import { saveWithOutbox } from '@bnpl/outbox';
import { RabbitMqPublisherService } from '@bnpl/rabbitmq-client';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ChargeInstallmentCommand } from './charge-installment-command';
import { Installment } from '../entities/installment.entity';
import { InstallmentPlan } from '../entities/installment-plan.entity';
import { UseCase } from './use-case.interface';

/**
 * Processes one due installment, found by `PollDueInstallmentsUseCase`:
 * marks it `DUE` the first time it crosses `dueDate` (publishing
 * `bnpl.installment.due.v1`, which notification-service already listens
 * for), then (re)publishes the `payment.charge_installment` command.
 *
 * Looking up the owning plan (`orderId`/`userId`/`currency`) is deliberately
 * a SEPARATE, unlocked query filtered by the relation id (`{ installments: {
 * id } }`) rather than an eager `relations: ['plan']` join on the locked
 * read below — Postgres rejects `FOR UPDATE` combined with a join (this bit
 * `cancel-installment-plan.use-case.ts`/`adjust-installment-plan.use-case.ts`
 * before; see their history). Splitting the two queries avoids that
 * entirely instead of routing around it with lock hints.
 *
 * Republishing the charge command on every poll tick while an installment
 * sits at `DUE` (rather than only once, on the PENDING -> DUE transition)
 * is a deliberate simplification: with the fake gateway's ~2s capture
 * confirmation this never meaningfully double-publishes in practice, and
 * `PaymentsService.chargeInstallment()` treats a redelivered command for an
 * installment that already has an in-flight charge as a safe no-op anyway.
 */
@Injectable()
export class ChargeDueInstallmentUseCase implements UseCase<{ installmentId: string }, void> {
  private readonly logger = new Logger(ChargeDueInstallmentUseCase.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly rabbitPublisher: RabbitMqPublisherService,
    private readonly requestContext: RequestContextService,
  ) {}

  async execute({ installmentId }: { installmentId: string }): Promise<void> {
    const plan = await this.dataSource.manager.findOne(InstallmentPlan, {
      where: { installments: { id: installmentId } },
    });
    if (!plan) {
      this.logger.warn(`No plan found for installment ${installmentId}, ignoring`);
      return;
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let installment: Installment;
    try {
      const found = await queryRunner.manager.findOne(Installment, {
        where: { id: installmentId },
        lock: { mode: 'pessimistic_write' },
      });
      const isChargeable =
        found && (found.status === InstallmentStatus.PENDING || found.status === InstallmentStatus.DUE);
      if (!found || !isChargeable || found.dueDate > new Date()) {
        // Already resolved (paid/cancelled/defaulted) or no longer due by
        // the time we got the lock — a safe no-op, not an error.
        await queryRunner.rollbackTransaction();
        return;
      }

      installment = found;
      if (installment.status === InstallmentStatus.PENDING) {
        installment.status = InstallmentStatus.DUE;
        installment = await saveWithOutbox(queryRunner, installment, {
          eventType: KafkaTopics.bnpl.installmentDue,
          aggregateType: 'Installment',
          aggregateId: installment.id,
          correlationId: this.requestContext.getCorrelationId() ?? randomUUID(),
          transactionId: plan.orderId,
          payload: {
            installmentId: installment.id,
            planId: plan.id,
            orderId: plan.orderId,
            userId: plan.userId,
            amountCents: installment.amountCents,
            dueDate: installment.dueDate,
          },
        });
      }

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    const command: ChargeInstallmentCommand = {
      installmentId: installment.id,
      planId: plan.id,
      orderId: plan.orderId,
      userId: plan.userId,
      amountCents: installment.amountCents,
      currency: plan.currency,
      attempt: installment.retryCount + 1,
    };

    // No inbound HTTP/Kafka request seeded this call (it originates from a
    // cron tick) — the publisher reads correlationId/transactionId from the
    // active RequestContext, so one has to be seeded here for those headers
    // to carry anything meaningful.
    this.requestContext.run({ correlationId: randomUUID(), transactionId: plan.orderId }, () => {
      this.rabbitPublisher.publish(RabbitMqTopology.exchange, RabbitMqTopology.routingKeys.paymentChargeInstallment, command);
    });
  }
}
