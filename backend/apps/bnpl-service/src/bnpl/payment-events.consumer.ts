import { EventEnvelope, KafkaTopics } from '@bnpl/event-contracts';
import { KafkaConsumerService } from '@bnpl/kafka-client';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BnplService, PaymentEventPayload } from './bnpl.service';

@Injectable()
export class PaymentEventsConsumer implements OnModuleInit {
  private readonly logger = new Logger(PaymentEventsConsumer.name);

  constructor(
    private readonly kafkaConsumer: KafkaConsumerService,
    private readonly bnplService: BnplService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.kafkaConsumer.subscribe(
      [
        KafkaTopics.payment.captured,
        KafkaTopics.payment.refunded,
        KafkaTopics.payment.partiallyRefunded,
        KafkaTopics.payment.chargebackReceived,
      ],
      (envelope) => this.handle(envelope),
      'bnpl-service',
    );
  }

  private async handle(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as PaymentEventPayload;
    switch (envelope.eventType) {
      case KafkaTopics.payment.captured:
        return this.bnplService.activatePlanForCapturedPayment(payload);
      case KafkaTopics.payment.refunded:
        return this.bnplService.cancelPlanForRefund(payload);
      case KafkaTopics.payment.partiallyRefunded:
        return this.bnplService.adjustPlanForPartialRefund(payload);
      case KafkaTopics.payment.chargebackReceived:
        return this.bnplService.holdPlanForChargeback(payload);
      default:
        this.logger.warn(`Unhandled event type: ${envelope.eventType}`);
    }
  }
}
