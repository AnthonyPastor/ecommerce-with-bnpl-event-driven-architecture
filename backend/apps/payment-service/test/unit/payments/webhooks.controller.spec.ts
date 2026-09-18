import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Transaction } from '../../../src/payments/entities/transaction.entity';
import { WebhookEvent } from '../../../src/payments/entities/webhook-event.entity';
import { WebhooksController } from '../../../src/payments/webhooks.controller';

function makeController(overrides?: { existingWebhookEvent?: WebhookEvent | null; transaction?: Transaction | null }) {
  const gateway = {
    verifyWebhookSignature: jest.fn(() => true),
    parseWebhookPayload: jest.fn(() => ({
      externalEventId: 'evt-1',
      gatewayReference: 'fake_txn-1',
      eventType: 'capture_succeeded' as const,
      amountCents: 1000,
    })),
  };
  const transactions = {
    findOne: jest.fn(async () =>
      overrides?.transaction === undefined ? ({ id: 'txn-1' } as Transaction) : overrides.transaction,
    ),
  };
  const webhookEvents = {
    findOne: jest.fn(async () => overrides?.existingWebhookEvent ?? null),
    create: jest.fn((data: unknown) => data),
    save: jest.fn(async (data: unknown) => data),
  };
  const rabbitPublisher = { publish: jest.fn(() => true) };

  const controller = new WebhooksController(
    gateway as any,
    transactions as any,
    webhookEvents as any,
    rabbitPublisher as any,
  );
  return { controller, gateway, transactions, webhookEvents, rabbitPublisher };
}

describe('WebhooksController.receiveWebhook', () => {
  it('rejects a payload with an invalid signature', async () => {
    const { controller, gateway } = makeController();
    gateway.verifyWebhookSignature.mockReturnValue(false);

    await expect(controller.receiveWebhook('fake', {}, {})).rejects.toThrow(UnauthorizedException);
  });

  it('is idempotent: a duplicate (gateway, externalEventId) is acknowledged without re-publishing', async () => {
    const { controller, rabbitPublisher, webhookEvents } = makeController({
      existingWebhookEvent: { id: 'we-1' } as WebhookEvent,
    });

    const result = await controller.receiveWebhook('fake', {}, {});

    expect(result).toEqual({ received: true, duplicate: true });
    expect(rabbitPublisher.publish).not.toHaveBeenCalled();
    expect(webhookEvents.save).not.toHaveBeenCalled();
  });

  it('404s when no transaction matches the gatewayReference', async () => {
    const { controller } = makeController({ transaction: null });
    await expect(controller.receiveWebhook('fake', {}, {})).rejects.toThrow(NotFoundException);
  });

  it('persists the WebhookEvent and publishes the command to RabbitMQ on a new, valid webhook', async () => {
    const { controller, webhookEvents, rabbitPublisher } = makeController();

    const result = await controller.receiveWebhook('fake', { some: 'body' }, {});

    expect(result).toEqual({ received: true });
    expect(webhookEvents.save).toHaveBeenCalledWith(
      expect.objectContaining({ gateway: 'fake', externalEventId: 'evt-1', transactionId: 'txn-1' }),
    );
    expect(rabbitPublisher.publish).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ gateway: 'fake', transactionId: 'txn-1' }),
    );
  });
});
