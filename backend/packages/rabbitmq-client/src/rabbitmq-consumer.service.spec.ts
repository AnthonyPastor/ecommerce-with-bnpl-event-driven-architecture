import { RequestContextService } from '@bnpl/observability';
import type { ConsumeMessage } from 'amqplib';
import { RabbitMqConsumerService } from './rabbitmq-consumer.service';
import { CORRELATION_ID_HEADER, RETRY_COUNT_HEADER, TRANSACTION_ID_HEADER } from './rabbitmq-headers';

function makeMessage(payload: unknown, headers: Record<string, unknown> = {}): ConsumeMessage {
  return {
    content: Buffer.from(JSON.stringify(payload)),
    properties: { headers },
    fields: {} as any,
  } as ConsumeMessage;
}

function makeService() {
  const channel = {
    consume: jest.fn(),
    ack: jest.fn(),
    sendToQueue: jest.fn(),
  } as any;
  const requestContext = new RequestContextService();
  const service = new RabbitMqConsumerService(channel, requestContext);
  return { service, channel, requestContext };
}

describe('RabbitMqConsumerService', () => {
  it('acks the message when the handler succeeds', async () => {
    const { service, channel } = makeService();
    const handler = jest.fn(async () => undefined);
    channel.consume.mockImplementation((_queue: string, cb: (m: ConsumeMessage) => void) => {
      cb(makeMessage({ foo: 'bar' }));
    });

    await service.subscribe('q.test', handler);
    await new Promise((r) => setImmediate(r));

    expect(handler).toHaveBeenCalledWith({ foo: 'bar' }, expect.anything());
    expect(channel.ack).toHaveBeenCalled();
    expect(channel.sendToQueue).not.toHaveBeenCalled();
  });

  it('routes to the retry queue with an incremented x-retry-count when under maxRetries', async () => {
    const { service, channel } = makeService();
    const handler = jest.fn(async () => {
      throw new Error('boom');
    });
    channel.consume.mockImplementation((_queue: string, cb: (m: ConsumeMessage) => void) => {
      cb(makeMessage({}, { [RETRY_COUNT_HEADER]: 1 }));
    });

    await service.subscribe('q.test', handler, { maxRetries: 3 });
    await new Promise((r) => setImmediate(r));

    expect(channel.sendToQueue).toHaveBeenCalledWith(
      'retry.q.test',
      expect.any(Buffer),
      expect.objectContaining({ headers: expect.objectContaining({ [RETRY_COUNT_HEADER]: 2 }) }),
    );
    expect(channel.ack).toHaveBeenCalled();
  });

  it('routes to the DLQ once retryCount reaches maxRetries', async () => {
    const { service, channel } = makeService();
    const handler = jest.fn(async () => {
      throw new Error('still failing');
    });
    channel.consume.mockImplementation((_queue: string, cb: (m: ConsumeMessage) => void) => {
      cb(makeMessage({}, { [RETRY_COUNT_HEADER]: 3 }));
    });

    await service.subscribe('q.test', handler, { maxRetries: 3 });
    await new Promise((r) => setImmediate(r));

    expect(channel.sendToQueue).toHaveBeenCalledWith(
      'dlq.q.test',
      expect.any(Buffer),
      expect.objectContaining({ headers: expect.objectContaining({ 'x-error': 'still failing' }) }),
    );
    expect(channel.ack).toHaveBeenCalled();
  });

  it('runs the handler inside the correlationId/transactionId extracted from message headers', async () => {
    const { service, channel, requestContext } = makeService();
    let seenCorrelationId: string | undefined;
    let seenTransactionId: string | undefined;
    const handler = jest.fn(async () => {
      seenCorrelationId = requestContext.getCorrelationId();
      seenTransactionId = requestContext.getTransactionId();
    });
    channel.consume.mockImplementation((_queue: string, cb: (m: ConsumeMessage) => void) => {
      cb(makeMessage({}, { [CORRELATION_ID_HEADER]: 'corr-9', [TRANSACTION_ID_HEADER]: 'txn-9' }));
    });

    await service.subscribe('q.test', handler);
    await new Promise((r) => setImmediate(r));

    expect(seenCorrelationId).toBe('corr-9');
    expect(seenTransactionId).toBe('txn-9');
  });
});
