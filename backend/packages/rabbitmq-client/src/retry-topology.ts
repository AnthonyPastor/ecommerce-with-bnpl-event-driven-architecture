import type { Channel } from 'amqplib';

export interface RetryTopologyOptions {
  exchange: string;
  routingKey: string;
  queue: string;
  /** TTL de la cola de reintento antes de reinyectar en la cola principal. */
  retryDelayMs: number;
}

export function retryQueueName(queue: string): string {
  return `retry.${queue}`;
}

export function dlqName(queue: string): string {
  return `dlq.${queue}`;
}

/**
 * Declara: exchange topic + cola principal bindeada, cola de retry (TTL fijo,
 * al expirar reinyecta en la cola principal vía dead-letter al exchange por
 * default con routing key = nombre de la cola principal), y la DLQ final.
 * El conteo de reintentos lo maneja el consumer (header x-retry-count), no
 * esta topología — ver RabbitMqConsumerService.
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
