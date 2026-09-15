import { RequestContextService } from '@bnpl/observability';
import { KafkaConsumerService } from '../../src/kafka-consumer.service';

function makeFakeConsumer() {
  return {
    connect: jest.fn(async () => undefined),
    subscribe: jest.fn(async () => undefined),
    run: jest.fn(async () => undefined),
    disconnect: jest.fn(async () => undefined),
  };
}

function makeService(consumer: ReturnType<typeof makeFakeConsumer>) {
  const kafka = { consumer: jest.fn(() => consumer) };
  const service = new KafkaConsumerService(kafka as any, 'test-group', new RequestContextService());
  return { service, kafka };
}

describe('KafkaConsumerService.subscribe', () => {
  it('subscribes immediately when there is no error', async () => {
    const consumer = makeFakeConsumer();
    const { service } = makeService(consumer);

    await service.subscribe(['topic.a'], jest.fn());

    expect(consumer.subscribe).toHaveBeenCalledTimes(1);
    expect(consumer.subscribe).toHaveBeenCalledWith({ topics: ['topic.a'], fromBeginning: false });
    expect(consumer.run).toHaveBeenCalled();
  });

  it('retries subscribe on transient errors (e.g. a brand-new topic not yet propagated) and eventually succeeds', async () => {
    const consumer = makeFakeConsumer();
    consumer.subscribe
      .mockRejectedValueOnce(new Error('This server does not host this topic-partition'))
      .mockRejectedValueOnce(new Error('This server does not host this topic-partition'))
      .mockResolvedValueOnce(undefined);
    const { service } = makeService(consumer);

    await service.subscribe(['topic.a'], jest.fn());

    expect(consumer.subscribe).toHaveBeenCalledTimes(3);
    expect(consumer.run).toHaveBeenCalled();
  }, 10000);

  it('gives up and throws after exhausting retries', async () => {
    const consumer = makeFakeConsumer();
    consumer.subscribe.mockRejectedValue(new Error('still broken'));
    const { service } = makeService(consumer);

    await expect(service.subscribe(['topic.a'], jest.fn())).rejects.toThrow('still broken');
    expect(consumer.run).not.toHaveBeenCalled();
  }, 10000);
});
