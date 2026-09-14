import type { EventEnvelope } from '@bnpl/event-contracts';
import { RequestContextService } from '@bnpl/observability';
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Consumer, EachMessagePayload, Kafka } from 'kafkajs';
import { headersToContext } from './kafka-headers';
import { KAFKA_CLIENT, KAFKA_GROUP_ID } from './kafka.constants';

export type KafkaEventHandler = (envelope: EventEnvelope, raw: EachMessagePayload) => Promise<void>;

@Injectable()
export class KafkaConsumerService implements OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private readonly consumers: Consumer[] = [];

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: Kafka,
    @Inject(KAFKA_GROUP_ID) private readonly defaultGroupId: string,
    private readonly requestContext: RequestContextService,
  ) {}

  /**
   * Se suscribe a `topics` y corre `handler` por cada mensaje DENTRO del
   * contexto de RequestContextService (correlationId/transactionId extraídos
   * de los headers del mensaje) — logs y eventos nuevos emitidos durante el
   * procesamiento heredan ese contexto automáticamente.
   */
  async subscribe(topics: string[], handler: KafkaEventHandler, groupId?: string): Promise<void> {
    const consumer = this.kafka.consumer({ groupId: groupId ?? this.defaultGroupId });
    await consumer.connect();
    await this.subscribeWithRetry(consumer, topics);

    await consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        const { correlationId, transactionId } = headersToContext(payload.message.headers);
        await this.requestContext.run({ correlationId, transactionId }, async () => {
          if (!payload.message.value) {
            this.logger.warn(`Empty message value on topic ${payload.topic}, skipping`);
            return;
          }
          const envelope = JSON.parse(payload.message.value.toString()) as EventEnvelope;
          try {
            await handler(envelope, payload);
          } catch (err) {
            this.logger.error(
              `Handler failed for ${envelope.eventType} (eventId=${envelope.eventId}): ${(err as Error).message}`,
            );
            throw err;
          }
        });
      },
    });

    this.consumers.push(consumer);
  }

  /**
   * En un broker single-node recién levantado, un topic auto-creado (por ser
   * la primera vez que alguien lo produce/consume) puede tardar un instante
   * en propagar su metadata — sin retry, `consumer.subscribe()` tira
   * "This server does not host this topic-partition" y el bootstrap del
   * servicio entero falla. Reintentamos unas pocas veces antes de rendirnos.
   */
  private async subscribeWithRetry(
    consumer: Consumer,
    topics: string[],
    maxAttempts = 5,
    delayMs = 500,
  ): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await consumer.subscribe({ topics, fromBeginning: false });
        return;
      } catch (err) {
        if (attempt >= maxAttempts) throw err;
        this.logger.warn(
          `Subscribe attempt ${attempt}/${maxAttempts} failed (${(err as Error).message}), retrying in ${delayMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.consumers.map((c) => c.disconnect()));
  }
}
