import { WebhookProcessorConsumer } from '../../../src/payments/webhook-processor.consumer';

jest.mock('@bnpl/rabbitmq-client', () => ({
  ...jest.requireActual('@bnpl/rabbitmq-client'),
  bindRetryTopology: jest.fn(async () => undefined),
}));

type Handler = (command: unknown) => Promise<void>;

function makeConsumer(overrides?: { processedAt?: Date | null }) {
  let capturedHandler: Handler | undefined;
  const rabbitConsumer = {
    subscribe: jest.fn(async (_queue: string, handler: Handler) => {
      capturedHandler = handler;
    }),
  };
  const paymentsService = { processWebhookEvent: jest.fn(async () => undefined) };
  const webhookEvents = {
    findOne: jest.fn(async () =>
      overrides?.processedAt === undefined ? null : { processedAt: overrides.processedAt },
    ),
    update: jest.fn(async () => undefined),
  };

  const consumer = new WebhookProcessorConsumer({} as any, rabbitConsumer as any, paymentsService as any, webhookEvents as any);
  return { consumer, paymentsService, webhookEvents, getHandler: () => capturedHandler! };
}

const command = {
  gateway: 'fake',
  transactionId: 'txn-1',
  normalized: {
    externalEventId: 'evt-1',
    gatewayReference: 'fake_txn-1',
    eventType: 'capture_succeeded' as const,
    amountCents: 1000,
  },
};

describe('WebhookProcessorConsumer', () => {
  it('processes a fresh webhook command and marks it processed', async () => {
    const { consumer, paymentsService, webhookEvents, getHandler } = makeConsumer();
    await consumer.onModuleInit();

    await getHandler()(command);

    expect(paymentsService.processWebhookEvent).toHaveBeenCalledWith('txn-1', command.normalized);
    expect(webhookEvents.update).toHaveBeenCalledWith(
      { gateway: 'fake', externalEventId: 'evt-1' },
      expect.objectContaining({ processedAt: expect.any(Date) }),
    );
  });

  it('skips reprocessing a webhook already marked processed (RabbitMQ redelivery)', async () => {
    const { consumer, paymentsService, webhookEvents, getHandler } = makeConsumer({ processedAt: new Date() });
    await consumer.onModuleInit();

    await getHandler()(command);

    expect(paymentsService.processWebhookEvent).not.toHaveBeenCalled();
    expect(webhookEvents.update).not.toHaveBeenCalled();
  });
});
