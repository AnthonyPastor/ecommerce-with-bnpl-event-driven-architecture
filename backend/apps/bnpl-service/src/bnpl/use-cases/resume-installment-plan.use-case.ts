import { InstallmentPlanStatus } from '@bnpl/event-contracts';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InstallmentPlan } from '../entities/installment-plan.entity';
import { PaymentEventPayload } from './payment-event-payload';
import { UseCase } from './use-case.interface';

/**
 * Reaction to `payment.transaction.dispute_resolved.v1`: the dispute that put
 * the plan on `DISPUTED_HOLD` (`HoldInstallmentPlanUseCase`) was resolved in
 * the merchant's favor, so charging can resume. No new domain event — same
 * as the hold, this is a pure internal state change. Doesn't touch
 * `CreditProfile.needsRescoring`: that flag is resolved by the rescoring
 * flow itself, not by this transition.
 *
 * Idempotent the same way as `HoldInstallmentPlanUseCase`: a pessimistic row
 * lock plus an early-return once the plan is no longer on hold.
 */
@Injectable()
export class ResumeInstallmentPlanUseCase implements UseCase<PaymentEventPayload, void> {
  private readonly logger = new Logger(ResumeInstallmentPlanUseCase.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

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
        this.logger.warn(`No installment plan found for order ${payload.orderId}, ignoring dispute-resolved event`);
        await queryRunner.rollbackTransaction();
        return;
      }
      if (plan.status !== InstallmentPlanStatus.DISPUTED_HOLD) {
        this.logger.log(`Installment plan ${plan.id} is not on hold, ignoring duplicate dispute-resolved event`);
        await queryRunner.rollbackTransaction();
        return;
      }

      plan.status = InstallmentPlanStatus.ACTIVE;
      await queryRunner.manager.save(plan);

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
