import { OutboxEvent } from './outbox-event.entity';
import { OutboxPublisherService } from './outbox-publisher.service';

function makeRow(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: 'evt-1',
    aggregateType: 'Order',
    aggregateId: 'order-1',
    eventType: 'order.order.created.v1',
    payload: { total: 100 },
    correlationId: 'corr-1',
    transactionId: 'txn-1',
    causationId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    publishedAt: null,
    ...overrides,
  };
}

describe('OutboxPublisherService', () => {
  function makeService(rows: OutboxEvent[]) {
    const saved: OutboxEvent[] = [];
    const repo = {
      find: jest.fn(async () => rows),
      save: jest.fn(async (row: OutboxEvent) => {
        saved.push(row);
        return row;
      }),
    };
    const kafkaProducer = { publish: jest.fn(async () => undefined) };
    const service = new OutboxPublisherService(
      repo as any,
      kafkaProducer as any,
      'order-service',
      500,
    );
    return { service, repo, kafkaProducer, saved };
  }

  it('publishes every pending row to Kafka and marks it published', async () => {
    const row = makeRow();
    const { service, kafkaProducer, saved } = makeService([row]);

    const count = await service.publishPending();

    expect(count).toBe(1);
    expect(kafkaProducer.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'evt-1',
        eventType: 'order.order.created.v1',
        correlationId: 'corr-1',
        transactionId: 'txn-1',
        aggregateType: 'Order',
        aggregateId: 'order-1',
        producer: 'order-service',
        payload: { total: 100 },
      }),
    );
    expect(saved[0].publishedAt).toBeInstanceOf(Date);
  });

  it('only queries rows with publishedAt IS NULL', async () => {
    const { service, repo } = makeService([]);
    await service.publishPending();
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ publishedAt: expect.anything() }) }),
    );
  });

  it('omits transactionId/causationId from the envelope when null on the row', async () => {
    const row = makeRow({ transactionId: null, causationId: null });
    const { service, kafkaProducer } = makeService([row]);

    await service.publishPending();

    const envelope = (kafkaProducer.publish as jest.Mock).mock.calls[0][0];
    expect(envelope.transactionId).toBeUndefined();
    expect(envelope.causationId).toBeUndefined();
  });

  it('returns 0 when there is nothing pending', async () => {
    const { service, kafkaProducer } = makeService([]);
    const count = await service.publishPending();
    expect(count).toBe(0);
    expect(kafkaProducer.publish).not.toHaveBeenCalled();
  });
});
