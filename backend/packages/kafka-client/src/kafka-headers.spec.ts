import { buildEventEnvelope } from '@bnpl/event-contracts';
import {
  CORRELATION_ID_HEADER,
  TRANSACTION_ID_HEADER,
  envelopeToHeaders,
  headersToContext,
} from './kafka-headers';

describe('kafka headers', () => {
  it('envelopeToHeaders includes correlationId always, transactionId/causationId only when present', () => {
    const withBoth = buildEventEnvelope({
      eventType: 'payment.transaction.captured.v1',
      aggregateType: 'Transaction',
      aggregateId: 'txn-1',
      producer: 'payment-service',
      correlationId: 'corr-1',
      transactionId: 'biz-txn-1',
      causationId: 'cause-1',
      payload: {},
    });
    const headers = envelopeToHeaders(withBoth);
    expect(headers[CORRELATION_ID_HEADER]).toBe('corr-1');
    expect(headers[TRANSACTION_ID_HEADER]).toBe('biz-txn-1');

    const withoutOptional = buildEventEnvelope({
      eventType: 'order.order.created.v1',
      aggregateType: 'Order',
      aggregateId: 'order-1',
      producer: 'order-service',
      correlationId: 'corr-2',
      payload: {},
    });
    const headers2 = envelopeToHeaders(withoutOptional);
    expect(headers2[TRANSACTION_ID_HEADER]).toBeUndefined();
  });

  it('headersToContext round-trips string header values', () => {
    const ctx = headersToContext({
      [CORRELATION_ID_HEADER]: 'corr-abc',
      [TRANSACTION_ID_HEADER]: 'txn-abc',
    });
    expect(ctx).toEqual({ correlationId: 'corr-abc', transactionId: 'txn-abc' });
  });

  it('headersToContext handles Buffer header values (as kafkajs delivers them on consume)', () => {
    const ctx = headersToContext({
      [CORRELATION_ID_HEADER]: Buffer.from('corr-buf'),
    });
    expect(ctx.correlationId).toBe('corr-buf');
    expect(ctx.transactionId).toBeUndefined();
  });

  it('headersToContext falls back to "unknown" correlationId when missing', () => {
    const ctx = headersToContext(undefined);
    expect(ctx.correlationId).toBe('unknown');
  });
});
