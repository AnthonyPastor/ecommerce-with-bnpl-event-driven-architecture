import type { EventEnvelope } from '@bnpl/event-contracts';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Kafka, Producer } from 'kafkajs';
import { envelopeToHeaders } from './kafka-headers';
import { KAFKA_CLIENT } from './kafka.constants';

@Injectable()
export class KafkaProducerService implements OnModuleDestroy {
  private producer: Producer | null = null;

  constructor(@Inject(KAFKA_CLIENT) private readonly kafka: Kafka) {}

  private async getProducer(): Promise<Producer> {
    if (!this.producer) {
      this.producer = this.kafka.producer();
      await this.producer.connect();
    }
    return this.producer;
  }

  /** Publica un evento de dominio: topic = envelope.eventType, key = aggregateId. */
  async publish(envelope: EventEnvelope): Promise<void> {
    const producer = await this.getProducer();
    await producer.send({
      topic: envelope.eventType,
      messages: [
        {
          key: envelope.aggregateId,
          value: JSON.stringify(envelope),
          headers: envelopeToHeaders(envelope),
        },
      ],
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
    }
  }
}
