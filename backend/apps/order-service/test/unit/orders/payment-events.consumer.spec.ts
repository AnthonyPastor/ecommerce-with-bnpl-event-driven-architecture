import { KafkaTopics, buildEventEnvelope } from '@bnpl/event-contracts';
import { PaymentEventsConsumer } from '../../../src/orders/payment-events.consumer';

function makeConsumer() {
  const kafkaConsumer = { subscribe: jest.fn(async () => undefined) };
  const ordersService = { markRefunded: jest.fn(async () => undefined) };
  const consumer = new PaymentEventsConsumer(kafkaConsumer as any, ordersService as any);
  return { consumer, kafkaConsumer, ordersService };
}

describe('PaymentEventsConsumer', () => {
  it('subscribes to payment.transaction.refunded.v1 on init', async () => {
    const { consumer, kafkaConsumer } = makeConsumer();
    await consumer.onModuleInit();
    expect(kafkaConsumer.subscribe).toHaveBeenCalledWith(
      [KafkaTopics.payment.refunded],
      expect.any(Function),
      'order-service',
    );
  });

  it('calls ordersService.markRefunded with the orderId from the event payload', async () => {
    const { consumer, kafkaConsumer, ordersService } = makeConsumer();
    await consumer.onModuleInit();
    const handler = (kafkaConsumer.subscribe as jest.Mock).mock.calls[0][1];

    const envelope = buildEventEnvelope({
      eventType: KafkaTopics.payment.refunded,
      aggregateType: 'Transaction',
      aggregateId: 'txn-1',
      producer: 'payment-service',
      correlationId: 'corr-1',
      payload: { orderId: 'order-1', userId: 'user-1' },
    });

    await handler(envelope);

    expect(ordersService.markRefunded).toHaveBeenCalledWith('order-1');
  });

  it('swallows errors from markRefunded so a missing order does not crash the consumer', async () => {
    const { consumer, kafkaConsumer, ordersService } = makeConsumer();
    ordersService.markRefunded.mockRejectedValue(new Error('order not found'));
    await consumer.onModuleInit();
    const handler = (kafkaConsumer.subscribe as jest.Mock).mock.calls[0][1];

    const envelope = buildEventEnvelope({
      eventType: KafkaTopics.payment.refunded,
      aggregateType: 'Transaction',
      aggregateId: 'txn-1',
      producer: 'payment-service',
      correlationId: 'corr-1',
      payload: { orderId: 'order-missing', userId: 'user-1' },
    });

    await expect(handler(envelope)).resolves.toBeUndefined();
  });
});
