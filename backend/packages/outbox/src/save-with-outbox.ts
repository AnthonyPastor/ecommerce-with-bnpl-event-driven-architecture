import type { ObjectLiteral, QueryRunner } from 'typeorm';
import { OutboxEvent } from './outbox-event.entity';

export interface OutboxEventInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  correlationId: string;
  transactionId?: string;
  causationId?: string;
}

/**
 * Guarda la entidad de dominio Y la fila de outbox en la MISMA transacción
 * (mismo QueryRunner, ya con `startTransaction()` corrido por el caller) —
 * o se guardan las dos o ninguna, resolviendo el dual-write problem entre
 * Postgres y Kafka. El caller es responsable de startTransaction/commit/rollback.
 */
export async function saveWithOutbox<T extends ObjectLiteral>(
  queryRunner: QueryRunner,
  entity: T,
  event: OutboxEventInput,
): Promise<T> {
  const saved = await queryRunner.manager.save(entity);

  const outboxRow = queryRunner.manager.create(OutboxEvent, {
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    payload: event.payload,
    correlationId: event.correlationId,
    transactionId: event.transactionId ?? null,
    causationId: event.causationId ?? null,
    publishedAt: null,
  });
  await queryRunner.manager.save(outboxRow);

  return saved;
}
