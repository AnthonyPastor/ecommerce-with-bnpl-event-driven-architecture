import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Common envelope for every domain event published on Kafka.
 * correlationId/transactionId/causationId also travel as headers
 * on the Kafka message (see packages/kafka-client) so they can be
 * filtered/propagated without deserializing the payload.
 */
export interface EventEnvelope<T = unknown> {
  eventId: string;
  eventType: string;
  version: number;
  occurredAt: string;
  correlationId: string;
  transactionId?: string;
  causationId?: string;
  aggregateType: string;
  aggregateId: string;
  producer: string;
  payload: T;
}

export const eventEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1),
  version: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  correlationId: z.string().min(1),
  transactionId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  producer: z.string().min(1),
  payload: z.unknown(),
});

export interface BuildEnvelopeInput<T> {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  producer: string;
  correlationId: string;
  transactionId?: string;
  causationId?: string;
  payload: T;
  version?: number;
}

export function buildEventEnvelope<T>(input: BuildEnvelopeInput<T>): EventEnvelope<T> {
  return {
    eventId: randomUUID(),
    eventType: input.eventType,
    version: input.version ?? 1,
    occurredAt: new Date().toISOString(),
    correlationId: input.correlationId,
    transactionId: input.transactionId,
    causationId: input.causationId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    producer: input.producer,
    payload: input.payload,
  };
}
