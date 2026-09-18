import { RabbitMqTopology } from '@bnpl/event-contracts';
import { RabbitMqPublisherService } from '@bnpl/rabbitmq-client';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transaction } from './entities/transaction.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { PAYMENT_GATEWAY, PaymentGatewayPort } from './ports/payment-gateway.port';

export interface WebhookCommandPayload {
  gateway: string;
  transactionId: string;
  normalized: ReturnType<PaymentGatewayPort['parseWebhookPayload']>;
}

@Controller('webhooks/payments')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    @InjectRepository(WebhookEvent) private readonly webhookEvents: Repository<WebhookEvent>,
    private readonly rabbitPublisher: RabbitMqPublisherService,
  ) {}

  /**
   * The controller only verifies the signature + persists WebhookEvent
   * (idempotency) + responds fast — the actual processing (applying the
   * state transition) happens async via RabbitMQ (see WebhookProcessorConsumer),
   * so we don't block the response to the gateway and can retry if something
   * fails.
   *
   * Note: to keep the skeleton simple, the "signature" is computed over
   * JSON.stringify(body) instead of the byte-exact raw body — a real
   * integration would need a dedicated raw-body parser for this route.
   */
  @Post(':gateway')
  @HttpCode(HttpStatus.OK)
  async receiveWebhook(
    @Param('gateway') gatewayName: string,
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string>,
  ) {
    const rawBody = Buffer.from(JSON.stringify(body));
    if (!this.gateway.verifyWebhookSignature(rawBody, headers)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const normalized = this.gateway.parseWebhookPayload(rawBody, headers);

    const existing = await this.webhookEvents.findOne({
      where: { gateway: gatewayName, externalEventId: normalized.externalEventId },
    });
    if (existing) {
      this.logger.log(`Duplicate webhook delivery ignored: ${normalized.externalEventId}`);
      return { received: true, duplicate: true };
    }

    const transaction = await this.transactions.findOne({
      where: { gatewayReference: normalized.gatewayReference },
    });
    if (!transaction) {
      throw new NotFoundException(`No transaction found for gatewayReference ${normalized.gatewayReference}`);
    }

    await this.webhookEvents.save(
      this.webhookEvents.create({
        gateway: gatewayName,
        externalEventId: normalized.externalEventId,
        transactionId: transaction.id,
        eventType: normalized.eventType,
        rawPayload: body,
        processedAt: null,
      }),
    );

    const command: WebhookCommandPayload = { gateway: gatewayName, transactionId: transaction.id, normalized };
    this.rabbitPublisher.publish(
      RabbitMqTopology.exchange,
      RabbitMqTopology.routingKeys.webhookPaymentProcess,
      command,
    );

    return { received: true };
  }
}
