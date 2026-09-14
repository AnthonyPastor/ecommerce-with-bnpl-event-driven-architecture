import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { FakePaymentGateway } from './fake-payment.gateway';

const SECRET = 'test-secret';

function makeGateway(captureDelayMs = 50) {
  const config = new ConfigService({
    FAKE_GATEWAY_WEBHOOK_SECRET: SECRET,
    PAYMENT_SERVICE_SELF_URL: 'http://localhost:9999',
    FAKE_GATEWAY_CAPTURE_DELAY_MS: captureDelayMs,
  });
  return new FakePaymentGateway(config);
}

describe('FakePaymentGateway', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('authorize() resolves immediately with a deterministic gatewayReference', async () => {
    const gateway = makeGateway();
    const result = await gateway.authorize({ transactionId: 'txn-1', amountCents: 1000, currency: 'USD' });
    expect(result.gatewayReference).toBe('fake_txn-1');
    gateway.onModuleDestroy();
  });

  it('verifyWebhookSignature accepts a correctly signed body and rejects a tampered one', () => {
    const gateway = makeGateway();
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    const validSignature = createHmac('sha256', SECRET).update(body).digest('hex');

    expect(gateway.verifyWebhookSignature(body, { 'x-fake-signature': validSignature })).toBe(true);
    expect(gateway.verifyWebhookSignature(body, { 'x-fake-signature': 'wrong' })).toBe(false);
  });

  it('parseWebhookPayload parses the JSON body into a NormalizedWebhookEvent', () => {
    const gateway = makeGateway();
    const payload = {
      externalEventId: 'evt-1',
      gatewayReference: 'fake_txn-1',
      eventType: 'capture_succeeded' as const,
      amountCents: 1000,
    };
    const parsed = gateway.parseWebhookPayload(Buffer.from(JSON.stringify(payload)), {});
    expect(parsed).toEqual(payload);
  });

  it('authorize() self-triggers a signed webhook call after the configured delay', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;

    const gateway = makeGateway(2000);
    await gateway.authorize({ transactionId: 'txn-42', amountCents: 5000, currency: 'USD' });

    expect(fetchMock).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2000);
    // deja correr las promesas encoladas por el setTimeout callback
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:9999/webhooks/payments/fake');
    expect(init.headers['x-fake-signature']).toEqual(expect.any(String));

    const sentBody = JSON.parse(init.body.toString());
    expect(sentBody).toMatchObject({ gatewayReference: 'fake_txn-42', eventType: 'capture_succeeded' });

    gateway.onModuleDestroy();
    jest.useRealTimers();
  });

  it('onModuleDestroy cancels pending scheduled webhooks', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;

    const gateway = makeGateway(2000);
    await gateway.authorize({ transactionId: 'txn-1', amountCents: 100, currency: 'USD' });
    gateway.onModuleDestroy();

    jest.advanceTimersByTime(5000);
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
