import { OutboxModule } from '@bnpl/outbox';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BnplController } from './bnpl.controller';
import { CreditScoringService } from './credit-scoring.service';
import { CreditProfile } from './entities/credit-profile.entity';
import { Installment } from './entities/installment.entity';
import { InstallmentPlan } from './entities/installment-plan.entity';
import { PaymentEventsConsumer } from './payment-events.consumer';
import { InstallmentPollerService } from './scheduler/installment-poller.service';
import { ActivateInstallmentPlanUseCase } from './use-cases/activate-installment-plan.use-case';
import { AdjustInstallmentPlanUseCase } from './use-cases/adjust-installment-plan.use-case';
import { CancelInstallmentPlanUseCase } from './use-cases/cancel-installment-plan.use-case';
import { ChargeDueInstallmentUseCase } from './use-cases/charge-due-installment.use-case';
import { GetInstallmentPlanUseCase } from './use-cases/get-installment-plan.use-case';
import { HoldInstallmentPlanUseCase } from './use-cases/hold-installment-plan.use-case';
import { ListInstallmentPlansUseCase } from './use-cases/list-installment-plans.use-case';
import { MarkInstallmentFailedUseCase } from './use-cases/mark-installment-failed.use-case';
import { MarkInstallmentPaidUseCase } from './use-cases/mark-installment-paid.use-case';
import { PollDueInstallmentsUseCase } from './use-cases/poll-due-installments.use-case';

@Module({
  imports: [
    TypeOrmModule.forFeature([CreditProfile, InstallmentPlan, Installment]),
    OutboxModule.forFeature({ producerName: 'bnpl-service' }),
  ],
  controllers: [BnplController],
  providers: [
    CreditScoringService,
    PaymentEventsConsumer,
    ActivateInstallmentPlanUseCase,
    CancelInstallmentPlanUseCase,
    AdjustInstallmentPlanUseCase,
    HoldInstallmentPlanUseCase,
    GetInstallmentPlanUseCase,
    ListInstallmentPlansUseCase,
    ChargeDueInstallmentUseCase,
    PollDueInstallmentsUseCase,
    MarkInstallmentPaidUseCase,
    MarkInstallmentFailedUseCase,
    InstallmentPollerService,
  ],
})
export class BnplModule {}
