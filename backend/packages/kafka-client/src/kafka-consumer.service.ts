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
   * Subscribes to `topics` and runs `handler` for each message INSIDE the
   * RequestContextService context (correlationId/transactionId extracted
   * from the message headers) — logs and new events emitted during
   * processing automatically inherit that context.
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
   * On a freshly started single-node broker, an auto-created topic (because
   * it's the first time anyone produces/consumes it) can take a moment to
   * propagate its metadata — without retry, `consumer.subscribe()` throws
   * "This server does not host this topic-partition" and the entire
   * service's bootstrap fails. We retry a few times before giving up.
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
