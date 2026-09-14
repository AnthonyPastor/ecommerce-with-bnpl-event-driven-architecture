import { RequestContextService } from '@bnpl/observability';
import { Inject, Injectable } from '@nestjs/common';
import type { Channel } from 'amqplib';
import { buildCommandHeaders } from './rabbitmq-headers';
import { RABBITMQ_CHANNEL } from './rabbitmq.constants';

@Injectable()
export class RabbitMqPublisherService {
  constructor(
    @Inject(RABBITMQ_CHANNEL) private readonly channel: Channel,
    private readonly requestContext: RequestContextService,
  ) {}

  /** Publica un comando, propagando correlationId/transactionId del contexto activo como headers. */
  publish(exchange: string, routingKey: string, payload: unknown): boolean {
    const ctx = this.requestContext.get();
    const headers = buildCommandHeaders({
      correlationId: ctx?.correlationId ?? 'unknown',
      transactionId: ctx?.transactionId,
    });
    return this.channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(payload)), {
      headers,
      persistent: true,
    });
  }
}
