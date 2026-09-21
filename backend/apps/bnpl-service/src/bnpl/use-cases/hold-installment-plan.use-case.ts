import { InstallmentPlanStatus } from '@bnpl/event-contracts';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreditScoringService } from '../credit-scoring.service';
import { InstallmentPlan } from '../entities/installment-plan.entity';
import { PaymentEventPayload } from './payment-event-payload';
import { UseCase } from './use-case.interface';

/**
 * Reaction to `payment.transaction.chargeback_received.v1`: pauses charges
 * and flags the profile for manual re-scoring. No new domain event for this
 * — it's a pure internal state change, so there's no outbox write here,
 * just the plan status and the credit profile flag inside one transaction.
 *
 * Idempotent the same way as `CancelInstallmentPlanUseCase`: a pessimistic
 * row lock plus an early-return once the plan is already on hold.
 *
 * Both side effects (plan status, credit profile flag) run inside the SAME
 * transaction/queryRunner — doing the credit-profile update after commit
 * would let it get silently skipped forever: a crash between commit and that
 * call, or the call itself failing, leaves the plan already at
 * DISPUTED_HOLD, so a Kafka redelivery of this event hits the early-return
 * above before ever retrying it.
 */
@Injectable()
export class HoldInstallmentPlanUseCase implements UseCase<PaymentEventPayload, void> {
  private readonly logger = new Logger(HoldInstallmentPlanUseCase.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly creditScoring: CreditScoringService,
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
        this.logger.warn(`No installment plan found for order ${payload.orderId}, ignoring chargeback event`);
        await queryRunner.rollbackTransaction();
        return;
      }
      if (plan.status === InstallmentPlanStatus.DISPUTED_HOLD) {
        this.logger.log(`Installment plan ${plan.id} already on hold, ignoring duplicate chargeback event`);
        await queryRunner.rollbackTransaction();
        return;
      }

      plan.status = InstallmentPlanStatus.DISPUTED_HOLD;
      await queryRunner.manager.save(plan);

      await this.creditScoring.markNeedsRescoring(payload.userId, queryRunner.manager);

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
