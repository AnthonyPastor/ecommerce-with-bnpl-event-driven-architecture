import { EventEnvelope, KafkaTopics } from '@bnpl/event-contracts';
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
      [KafkaTopics.payment.refunded],
      (envelope) => this.handle(envelope),
      'order-service',
    );
  }

  private async handle(envelope: EventEnvelope): Promise<void> {
    if (envelope.eventType !== KafkaTopics.payment.refunded) {
      return;
    }
    const payload = envelope.payload as { orderId: string };
    try {
      await this.ordersService.markRefunded(payload.orderId);
    } catch (err) {
      this.logger.warn(`Could not mark order ${payload.orderId} as refunded: ${(err as Error).message}`);
    }
  }
}
