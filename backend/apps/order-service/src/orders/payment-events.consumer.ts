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
      [KafkaTopics.payment.refunded, KafkaTopics.payment.captured],
      (envelope) => this.handle(envelope),
      'order-service',
    );
  }

  private async handle(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as { orderId: string; paymentMethod?: PaymentMethod };
    try {
      if (envelope.eventType === KafkaTopics.payment.refunded) {
        await this.ordersService.markRefunded(payload.orderId);
      } else if (envelope.eventType === KafkaTopics.payment.captured) {
        await this.ordersService.markConfirmed(payload.orderId, payload.paymentMethod ?? null);
      }
    } catch (err) {
      this.logger.warn(`Could not apply payment event ${envelope.eventType} to order ${payload.orderId}: ${(err as Error).message}`);
    }
  }
}
