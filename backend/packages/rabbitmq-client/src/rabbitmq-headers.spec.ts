import {
  CORRELATION_ID_HEADER,
  RETRY_COUNT_HEADER,
  buildCommandHeaders,
  getRetryCount,
  headersToContext,
} from './rabbitmq-headers';

describe('rabbitmq headers', () => {
  it('buildCommandHeaders includes transactionId only when present', () => {
    expect(buildCommandHeaders({ correlationId: 'c1' })).toEqual({ [CORRELATION_ID_HEADER]: 'c1' });
    expect(buildCommandHeaders({ correlationId: 'c1', transactionId: 't1' })[CORRELATION_ID_HEADER]).toBe(
      'c1',
    );
  });

  it('headersToContext handles plain strings and Buffers, defaults correlationId to "unknown"', () => {
    expect(headersToContext({ [CORRELATION_ID_HEADER]: 'abc' }).correlationId).toBe('abc');
    expect(headersToContext({ [CORRELATION_ID_HEADER]: Buffer.from('buf-val') }).correlationId).toBe(
      'buf-val',
    );
    expect(headersToContext(undefined).correlationId).toBe('unknown');
  });

  it('getRetryCount defaults to 0 and parses numeric header values', () => {
    expect(getRetryCount(undefined)).toBe(0);
    expect(getRetryCount({ [RETRY_COUNT_HEADER]: 2 })).toBe(2);
    expect(getRetryCount({ [RETRY_COUNT_HEADER]: Buffer.from('3') })).toBe(3);
  });
});
