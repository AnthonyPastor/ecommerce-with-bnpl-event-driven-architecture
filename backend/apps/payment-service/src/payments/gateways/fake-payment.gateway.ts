import { randomUUID, createHmac } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuthorizeInput,
  AuthorizeResult,
  CaptureInput,
  CaptureResult,
  NormalizedWebhookEvent,
  PaymentGatewayPort,
  RefundInput,
  RefundResult,
  VoidInput,
  VoidResult,
} from '../ports/payment-gateway.port';

/**
 * Implementación fake del payment gateway: `authorize` responde sync
 * (como haría cualquier gateway real al autorizar), pero la confirmación de
 * captura llega ASYNC vía un webhook simulado que este mismo gateway se
 * auto-dispara (self-loopback HTTP real a `PAYMENT_SERVICE_SELF_URL`) con un
 * delay corto — así se ejercita el camino asíncrono real (webhook controller
 * -> idempotencia -> RabbitMQ -> consumer -> transición de estado) desde el
 * día uno, no solo el happy path síncrono.
 */
@Injectable()
export class FakePaymentGateway extends PaymentGatewayPort implements OnModuleDestroy {
  private readonly logger = new Logger(FakePaymentGateway.name);
  private readonly secret: string;
  private readonly selfBaseUrl: string;
  private readonly captureDelayMs: number;
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(private readonly config: ConfigService) {
    super();
    this.secret = this.config.get<string>('FAKE_GATEWAY_WEBHOOK_SECRET', 'fake-gateway-shared-secret');
    this.selfBaseUrl = this.config.get<string>('PAYMENT_SERVICE_SELF_URL', 'http://localhost:3005');
    this.captureDelayMs = Number(this.config.get('FAKE_GATEWAY_CAPTURE_DELAY_MS', 2000));
  }

  async authorize(input: AuthorizeInput): Promise<AuthorizeResult> {
    const gatewayReference = `fake_${input.transactionId}`;
    this.scheduleWebhook({
      externalEventId: randomUUID(),
      gatewayReference,
      eventType: 'capture_succeeded',
      amountCents: input.amountCents,
    });
    return { gatewayReference };
  }

  async capture(input: CaptureInput): Promise<CaptureResult> {
    return { gatewayReference: input.gatewayReference };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    this.scheduleWebhook({
      externalEventId: randomUUID(),
      gatewayReference: input.gatewayReference,
      eventType: 'refund_succeeded',
      amountCents: input.amountCents,
    });
    return { gatewayReference: input.gatewayReference };
  }

  async void(input: VoidInput): Promise<VoidResult> {
    return { gatewayReference: input.gatewayReference };
  }

  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string>): boolean {
    const expected = createHmac('sha256', this.secret).update(rawBody).digest('hex');
    return headers['x-fake-signature'] === expected;
  }

  parseWebhookPayload(rawBody: Buffer, _headers: Record<string, string>): NormalizedWebhookEvent {
    return JSON.parse(rawBody.toString()) as NormalizedWebhookEvent;
  }

  private scheduleWebhook(event: NormalizedWebhookEvent): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.sendWebhook(event).catch((err: Error) =>
        this.logger.error(`Failed to deliver simulated webhook: ${err.message}`),
      );
    }, this.captureDelayMs);
    this.timers.add(timer);
  }

  private async sendWebhook(event: NormalizedWebhookEvent): Promise<void> {
    const body = Buffer.from(JSON.stringify(event));
    const signature = createHmac('sha256', this.secret).update(body).digest('hex');
    await fetch(`${this.selfBaseUrl}/webhooks/payments/fake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fake-signature': signature },
      body,
    });
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}
