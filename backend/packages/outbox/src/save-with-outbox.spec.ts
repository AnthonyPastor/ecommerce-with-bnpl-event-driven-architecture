import type { QueryRunner } from 'typeorm';
import { OutboxEvent } from './outbox-event.entity';
import { saveWithOutbox } from './save-with-outbox';

function makeQueryRunner() {
  const saved: unknown[] = [];
  const created: unknown[] = [];
  const queryRunner = {
    manager: {
      save: jest.fn(async (entity: unknown) => {
        saved.push(entity);
        return entity;
      }),
      create: jest.fn((_cls: unknown, data: unknown) => {
        created.push(data);
        return data;
      }),
    },
  } as unknown as QueryRunner;
  return { queryRunner, saved, created };
}

describe('saveWithOutbox', () => {
  it('saves the domain entity and an outbox row using the same queryRunner (same transaction)', async () => {
    const { queryRunner, saved, created } = makeQueryRunner();
    const domainEntity = { id: 'order-1', total: 100 };

    const result = await saveWithOutbox(queryRunner, domainEntity, {
      eventType: 'order.order.created.v1',
      aggregateType: 'Order',
      aggregateId: 'order-1',
      payload: { total: 100 },
      correlationId: 'corr-1',
      transactionId: 'txn-1',
    });

    expect(result).toBe(domainEntity);
    expect(saved).toHaveLength(2);
    expect(saved[0]).toBe(domainEntity);

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      aggregateType: 'Order',
      aggregateId: 'order-1',
      eventType: 'order.order.created.v1',
      correlationId: 'corr-1',
      transactionId: 'txn-1',
      publishedAt: null,
    });
  });

  it('defaults transactionId/causationId to null when not provided', async () => {
    const { queryRunner, created } = makeQueryRunner();

    await saveWithOutbox(
      queryRunner,
      { id: 'x' },
      {
        eventType: 'cart.cart.checked_out.v1',
        aggregateType: 'Cart',
        aggregateId: 'cart-1',
        payload: {},
        correlationId: 'corr-2',
      },
    );

    expect(created[0]).toMatchObject({ transactionId: null, causationId: null });
  });

  it('uses the OutboxEvent entity class when creating the outbox row', async () => {
    const { queryRunner } = makeQueryRunner();
    const createSpy = queryRunner.manager.create as jest.Mock;

    await saveWithOutbox(
      queryRunner,
      { id: 'x' },
      {
        eventType: 'order.order.created.v1',
        aggregateType: 'Order',
        aggregateId: 'order-1',
        payload: {},
        correlationId: 'corr-1',
      },
    );

    expect(createSpy).toHaveBeenCalledWith(OutboxEvent, expect.any(Object));
  });
});
