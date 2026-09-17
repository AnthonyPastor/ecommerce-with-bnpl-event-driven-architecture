import { EventEnvelope, KafkaTopics, PaymentMethod } from '@bnpl/event-contracts';
import { KafkaConsumerService } from '@bnpl/kafka-client';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OrdersService } from './orders.service';

@Injectable()
export class PaymentEventsConsumer implements OnModuleInit {
  private readonly logger = new Logger(PaymentEventsConsumer.name);

  constructor(
    private readonly kafkaConsumer: KafkaConsumerService,
    private readonly ordersService: OrdersService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.kafkaConsumer.subscribe(
      [
        KafkaTopics.payment.refunded,
        KafkaTopics.payment.captured,
        KafkaTopics.payment.partiallyRefunded,
        KafkaTopics.payment.disputeOpened,
        KafkaTopics.payment.chargebackReceived,
      ],
      (envelope) => this.handle(envelope),
      'order-service',
    );
  }

  private async handle(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as { orderId: string; paymentMethod?: PaymentMethod };
    try {
      switch (envelope.eventType) {
        case KafkaTopics.payment.refunded:
          await this.ordersService.markRefunded(payload.orderId);
          break;
        case KafkaTopics.payment.captured: {
          // Transaction.paymentMethod is NOT NULL and always set at creation
          // (defaults to INSTALLMENTS), so the captured payload should always
          // carry it too — this fallback only guards against payload schema
          // drift from an older/misbehaving producer, and is logged as such
          // rather than silently mislabeling a possibly-FULL payment.
          let paymentMethod = payload.paymentMethod;
          if (!paymentMethod) {
            this.logger.warn(
              `payment.transaction.captured.v1 for order ${payload.orderId} is missing paymentMethod; defaulting to INSTALLMENTS`,
            );
            paymentMethod = PaymentMethod.INSTALLMENTS;
          }
          await this.ordersService.markConfirmed(payload.orderId, paymentMethod);
          break;
        }
        case KafkaTopics.payment.partiallyRefunded:
          await this.ordersService.markPaymentIncident(payload.orderId, 'PARTIALLY_REFUNDED');
          break;
        case KafkaTopics.payment.disputeOpened:
          await this.ordersService.markPaymentIncident(payload.orderId, 'DISPUTED');
          break;
        case KafkaTopics.payment.chargebackReceived:
          await this.ordersService.markPaymentIncident(payload.orderId, 'CHARGEBACK');
          break;
      }
    } catch (err) {
      this.logger.warn(`Could not apply payment event ${envelope.eventType} to order ${payload.orderId}: ${(err as Error).message}`);
    }
  }
}
