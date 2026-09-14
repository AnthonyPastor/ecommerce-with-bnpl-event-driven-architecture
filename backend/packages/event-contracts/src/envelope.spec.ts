import { buildEventEnvelope, eventEnvelopeSchema } from './envelope';

describe('buildEventEnvelope', () => {
  it('produces an envelope that satisfies eventEnvelopeSchema', () => {
    const envelope = buildEventEnvelope({
      eventType: 'order.order.created.v1',
      aggregateType: 'Order',
      aggregateId: 'order-123',
      producer: 'order-service',
      correlationId: 'corr-1',
      transactionId: 'txn-1',
      payload: { total: 100 },
    });

    expect(eventEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(envelope.version).toBe(1);
    expect(envelope.causationId).toBeUndefined();
  });

  it('carries causationId when replying to another event', () => {
    const envelope = buildEventEnvelope({
      eventType: 'bnpl.installment.paid.v1',
      aggregateType: 'Installment',
      aggregateId: 'inst-1',
      producer: 'bnpl-service',
      correlationId: 'corr-2',
      causationId: 'event-that-triggered-this',
      payload: {},
    });

    expect(envelope.causationId).toBe('event-that-triggered-this');
  });
});
