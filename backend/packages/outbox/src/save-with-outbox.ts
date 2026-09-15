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
 * Saves the domain entity AND the outbox row in the SAME transaction
 * (same QueryRunner, with `startTransaction()` already run by the caller) —
 * either both are saved or neither is, solving the dual-write problem between
 * Postgres and Kafka. The caller is responsible for startTransaction/commit/rollback.
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
