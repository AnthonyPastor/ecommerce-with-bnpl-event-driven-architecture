import { WebhookProcessorConsumer } from '../../../src/payments/webhook-processor.consumer';

jest.mock('@bnpl/rabbitmq-client', () => ({
  ...jest.requireActual('@bnpl/rabbitmq-client'),
  bindRetryTopology: jest.fn(async () => undefined),
}));

type Handler = (command: unknown) => Promise<void>;

/**
 * The claim is a locked read-then-write inside one transaction (see
 * `WebhookProcessorConsumer.claimWebhookEvent`), so the fake `dataSource`
 * just runs the callback against a fake manager backed by a single record —
 * good enough to exercise "already claimed" vs "claim succeeds".
 */
function makeConsumer(overrides?: { processedAt?: Date | null; exists?: boolean }) {
  let capturedHandler: Handler | undefined;
  const rabbitConsumer = {
    subscribe: jest.fn(async (_queue: string, handler: Handler) => {
      capturedHandler = handler;
    }),
  };
  const paymentsService = { processWebhookEvent: jest.fn(async () => undefined) };

  let record: { processedAt: Date | null } | null =
    overrides?.exists === false ? null : { processedAt: overrides?.processedAt ?? null };

  const manager = {
    findOne: jest.fn(async () => record),
    save: jest.fn(async (entity: any) => {
      record = { ...record, ...entity };
      return entity;
    }),
  };
  const dataSource = {
    transaction: jest.fn(async (cb: (manager: unknown) => Promise<unknown>) => cb(manager)),
  };
  const webhookEvents = {
    findOne: jest.fn(async () => record),
    update: jest.fn(async () => undefined),
  };

  const consumer = new WebhookProcessorConsumer(
    {} as any,
    rabbitConsumer as any,
    paymentsService as any,
    webhookEvents as any,
    dataSource as any,
  );
  return { consumer, paymentsService, webhookEvents, manager, getRecord: () => record, getHandler: () => capturedHandler! };
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
  it('processes a fresh webhook command and claims it atomically', async () => {
    const { consumer, paymentsService, manager, getRecord, getHandler } = makeConsumer();
    await consumer.onModuleInit();

    await getHandler()(command);

    expect(manager.findOne).toHaveBeenCalled();
    expect(getRecord()).toMatchObject({ processedAt: expect.any(Date) });
    expect(paymentsService.processWebhookEvent).toHaveBeenCalledWith('txn-1', command.normalized);
  });

  it('skips reprocessing a webhook already marked processed (RabbitMQ redelivery)', async () => {
    const { consumer, paymentsService, getHandler } = makeConsumer({ processedAt: new Date() });
    await consumer.onModuleInit();

    await getHandler()(command);

    expect(paymentsService.processWebhookEvent).not.toHaveBeenCalled();
  });

  it('releases the claim so a genuine retry can reprocess when processWebhookEvent fails', async () => {
    const { consumer, paymentsService, webhookEvents, getHandler } = makeConsumer();
    paymentsService.processWebhookEvent.mockRejectedValueOnce(new Error('db exploded'));
    await consumer.onModuleInit();

    await expect(getHandler()(command)).rejects.toThrow('db exploded');

    expect(webhookEvents.update).toHaveBeenCalledWith(
      { gateway: 'fake', externalEventId: 'evt-1' },
      { processedAt: null },
    );
  });
});
