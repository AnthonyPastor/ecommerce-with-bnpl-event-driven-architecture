import { EventEnvelope, KafkaTopics } from '@bnpl/event-contracts';
import { KafkaConsumerService } from '@bnpl/kafka-client';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ActivateInstallmentPlanUseCase } from './use-cases/activate-installment-plan.use-case';
import { AdjustInstallmentPlanUseCase } from './use-cases/adjust-installment-plan.use-case';
import { CancelInstallmentPlanUseCase } from './use-cases/cancel-installment-plan.use-case';
import { HoldInstallmentPlanUseCase } from './use-cases/hold-installment-plan.use-case';
import { MarkInstallmentFailedUseCase } from './use-cases/mark-installment-failed.use-case';
import { MarkInstallmentPaidUseCase } from './use-cases/mark-installment-paid.use-case';
import { PaymentEventPayload } from './use-cases/payment-event-payload';
import { ResumeInstallmentPlanUseCase } from './use-cases/resume-installment-plan.use-case';

@Injectable()
export class PaymentEventsConsumer implements OnModuleInit {
  private readonly logger = new Logger(PaymentEventsConsumer.name);

  constructor(
    private readonly kafkaConsumer: KafkaConsumerService,
    private readonly activatePlan: ActivateInstallmentPlanUseCase,
    private readonly cancelPlan: CancelInstallmentPlanUseCase,
    private readonly adjustPlan: AdjustInstallmentPlanUseCase,
    private readonly holdPlan: HoldInstallmentPlanUseCase,
    private readonly markInstallmentPaid: MarkInstallmentPaidUseCase,
    private readonly markInstallmentFailed: MarkInstallmentFailedUseCase,
    private readonly resumePlan: ResumeInstallmentPlanUseCase,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.kafkaConsumer.subscribe(
      [
        KafkaTopics.payment.captured,
        KafkaTopics.payment.refunded,
        KafkaTopics.payment.partiallyRefunded,
        KafkaTopics.payment.chargebackReceived,
        KafkaTopics.payment.installmentChargeCaptured,
        KafkaTopics.payment.installmentChargeFailed,
        KafkaTopics.payment.disputeResolved,
      ],
      (envelope) => this.handle(envelope),
      'bnpl-service',
    );
  }

  private async handle(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as PaymentEventPayload;
    switch (envelope.eventType) {
      case KafkaTopics.payment.captured:
        return this.activatePlan.execute(payload);
      case KafkaTopics.payment.refunded:
        return this.cancelPlan.execute(payload);
      case KafkaTopics.payment.partiallyRefunded:
        return this.adjustPlan.execute({ payload, eventId: envelope.eventId });
      case KafkaTopics.payment.chargebackReceived:
        return this.holdPlan.execute(payload);
      case KafkaTopics.payment.installmentChargeCaptured:
        return this.markInstallmentPaid.execute(payload);
      case KafkaTopics.payment.installmentChargeFailed:
        return this.markInstallmentFailed.execute(payload);
      case KafkaTopics.payment.disputeResolved:
        return this.resumePlan.execute(payload);
      default:
        this.logger.warn(`Unhandled event type: ${envelope.eventType}`);
    }
  }
}
