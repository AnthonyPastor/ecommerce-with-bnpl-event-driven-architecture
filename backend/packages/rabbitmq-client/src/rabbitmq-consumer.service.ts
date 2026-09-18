import { RequestContextService } from '@bnpl/observability';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Channel, ConsumeMessage } from 'amqplib';
import { RETRY_COUNT_HEADER, getRetryCount, headersToContext } from './rabbitmq-headers';
import { dlqName, retryQueueName } from './retry-topology';
import { RABBITMQ_CHANNEL } from './rabbitmq.constants';

export type CommandHandler<T = unknown> = (payload: T, raw: ConsumeMessage) => Promise<void>;

export interface SubscribeOptions {
  maxRetries?: number;
}

@Injectable()
export class RabbitMqConsumerService {
  private readonly logger = new Logger(RabbitMqConsumerService.name);

  constructor(
    @Inject(RABBITMQ_CHANNEL) private readonly channel: Channel,
    private readonly requestContext: RequestContextService,
  ) {}

  /**
   * Consumes `queue` running `handler` inside the RequestContextService
   * context. If the handler fails: it retries via the `retry.<queue>` queue
   * (TTL declared by bindRetryTopology) up to `maxRetries` times (counted in
   * the `x-retry-count` header, which survives the dead-letter trip back),
   * and after that sends it to `dlq.<queue>`.
   */
  async subscribe<T = unknown>(
    queue: string,
    handler: CommandHandler<T>,
    options: SubscribeOptions = {},
  ): Promise<void> {
    const maxRetries = options.maxRetries ?? 3;

    await this.channel.consume(queue, (msg) => {
      if (!msg) return;
      void this.handleMessage(queue, msg, handler, maxRetries);
    });
  }

  private async handleMessage<T>(
    queue: string,
    msg: ConsumeMessage,
    handler: CommandHandler<T>,
    maxRetries: number,
  ): Promise<void> {
    const headers = msg.properties.headers as Record<string, unknown> | undefined;
    const { correlationId, transactionId } = headersToContext(headers);
    const retryCount = getRetryCount(headers);

    await this.requestContext.run({ correlationId, transactionId }, async () => {
      try {
        const payload = JSON.parse(msg.content.toString()) as T;
        await handler(payload, msg);
        this.channel.ack(msg);
      } catch (err) {
        const error = err as Error;
        if (retryCount >= maxRetries) {
          this.logger.error(
            `Exhausted ${maxRetries} retries for ${queue}, routing to DLQ: ${error.message}`,
          );
          this.channel.sendToQueue(dlqName(queue), msg.content, {
            headers: { ...headers, [RETRY_COUNT_HEADER]: retryCount, 'x-error': error.message },
            persistent: true,
          });
        } else {
          this.logger.warn(
            `Handler failed for ${queue} (attempt ${retryCount + 1}/${maxRetries}): ${error.message}`,
          );
          this.channel.sendToQueue(retryQueueName(queue), msg.content, {
            headers: { ...headers, [RETRY_COUNT_HEADER]: retryCount + 1 },
            persistent: true,
          });
        }
        this.channel.ack(msg);
      }
    });
  }
}
