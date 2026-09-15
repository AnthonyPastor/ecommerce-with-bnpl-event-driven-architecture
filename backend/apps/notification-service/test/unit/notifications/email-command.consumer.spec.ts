import { EmailCommandConsumer } from '../../../src/notifications/email-command.consumer';

function makeConsumer() {
  const channel = {
    assertExchange: jest.fn(async () => undefined),
    assertQueue: jest.fn(async () => undefined),
    bindQueue: jest.fn(async () => undefined),
  };
  const rabbitConsumer = { subscribe: jest.fn(async () => undefined) };
  const emailProvider = { send: jest.fn(async () => undefined) };
  const logs = { create: jest.fn((data: any) => data), save: jest.fn(async (data: any) => data) };

  const consumer = new EmailCommandConsumer(
    channel as any,
    rabbitConsumer as any,
    emailProvider as any,
    logs as any,
  );
  return { consumer, rabbitConsumer, emailProvider, logs };
}

describe('EmailCommandConsumer', () => {
  it('subscribes to the notifications email queue with a maxRetries option', async () => {
    const { consumer, rabbitConsumer } = makeConsumer();
    await consumer.onModuleInit();
    expect(rabbitConsumer.subscribe).toHaveBeenCalledWith(
      'q.notifications.email.send',
      expect.any(Function),
      { maxRetries: 3 },
    );
  });

  it('the subscribed handler sends the email and persists a NotificationLog row', async () => {
    const { consumer, rabbitConsumer, emailProvider, logs } = makeConsumer();
    await consumer.onModuleInit();

    const handler = (rabbitConsumer.subscribe as jest.Mock).mock.calls[0][1];
    const command = { to: 'user-1', template: 'order_confirmation', data: { orderId: 'order-1' } };
    await handler(command);

    expect(emailProvider.send).toHaveBeenCalledWith(command);
    expect(logs.save).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user-1', template: 'order_confirmation', sentAt: expect.any(Date) }),
    );
  });
});
