import { bindRetryTopology, dlqName, retryQueueName } from '../../src/retry-topology';

function makeChannel() {
  return {
    assertExchange: jest.fn(async () => undefined),
    assertQueue: jest.fn(async () => undefined),
    bindQueue: jest.fn(async () => undefined),
  } as any;
}

describe('bindRetryTopology', () => {
  it('declares the exchange, main queue, retry queue (with TTL + dead-letter back to main) and DLQ', async () => {
    const channel = makeChannel();

    await bindRetryTopology(channel, {
      exchange: 'commands',
      routingKey: 'webhook.payment.process',
      queue: 'q.payments.webhook.process',
      retryDelayMs: 5000,
    });

    expect(channel.assertExchange).toHaveBeenCalledWith('commands', 'topic', { durable: true });
    expect(channel.assertQueue).toHaveBeenCalledWith('q.payments.webhook.process', { durable: true });
    expect(channel.bindQueue).toHaveBeenCalledWith(
      'q.payments.webhook.process',
      'commands',
      'webhook.payment.process',
    );

    expect(channel.assertQueue).toHaveBeenCalledWith(
      'retry.q.payments.webhook.process',
      expect.objectContaining({
        durable: true,
        arguments: expect.objectContaining({
          'x-message-ttl': 5000,
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': 'q.payments.webhook.process',
        }),
      }),
    );

    expect(channel.assertQueue).toHaveBeenCalledWith('dlq.q.payments.webhook.process', { durable: true });
  });

  it('retryQueueName / dlqName follow the retry.<queue> / dlq.<queue> convention', () => {
    expect(retryQueueName('q.foo')).toBe('retry.q.foo');
    expect(dlqName('q.foo')).toBe('dlq.q.foo');
  });
});
