import type { Channel } from 'amqplib';

export interface RetryTopologyOptions {
  exchange: string;
  routingKey: string;
  queue: string;
  /** TTL of the retry queue before re-injecting into the main queue. */
  retryDelayMs: number;
}

export function retryQueueName(queue: string): string {
  return `retry.${queue}`;
}

export function dlqName(queue: string): string {
  return `dlq.${queue}`;
}

/**
 * Declares: topic exchange + bound main queue, retry queue (fixed TTL,
 * on expiry re-injects into the main queue via dead-letter to the default
 * exchange with routing key = main queue name), and the final DLQ.
 * Retry counting is handled by the consumer (x-retry-count header), not
 * by this topology — see RabbitMqConsumerService.
 */
export async function bindRetryTopology(channel: Channel, options: RetryTopologyOptions): Promise<void> {
  const { exchange, routingKey, queue, retryDelayMs } = options;
  const retryQueue = retryQueueName(queue);
  const dlq = dlqName(queue);

  await channel.assertExchange(exchange, 'topic', { durable: true });

  await channel.assertQueue(queue, { durable: true });
  await channel.bindQueue(queue, exchange, routingKey);

  await channel.assertQueue(retryQueue, {
    durable: true,
    arguments: {
      'x-message-ttl': retryDelayMs,
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': queue,
    },
  });

  await channel.assertQueue(dlq, { durable: true });
}
