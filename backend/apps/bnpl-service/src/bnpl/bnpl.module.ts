import { OutboxModule } from '@bnpl/outbox';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BnplController } from './bnpl.controller';
import { BnplService } from './bnpl.service';
import { CreditScoringService } from './credit-scoring.service';
import { CreditProfile } from './entities/credit-profile.entity';
import { Installment } from './entities/installment.entity';
import { InstallmentPlan } from './entities/installment-plan.entity';
import { PaymentEventsConsumer } from './payment-events.consumer';

@Module({
  imports: [
    TypeOrmModule.forFeature([CreditProfile, InstallmentPlan, Installment]),
    OutboxModule.forFeature({ producerName: 'bnpl-service' }),
  ],
  controllers: [BnplController],
  providers: [BnplService, CreditScoringService, PaymentEventsConsumer],
})
export class BnplModule {}
