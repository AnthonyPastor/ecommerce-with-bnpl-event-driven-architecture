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
   * El controller solo verifica firma + persiste WebhookEvent (idempotencia)
   * + responde rápido — el procesamiento real (aplicar la transición de
   * estado) ocurre async vía RabbitMQ (ver WebhookProcessorConsumer), para no
   * bloquear la respuesta al gateway y poder reintentar si algo falla.
   *
   * Nota: para simplificar el skeleton, la "firma" se calcula sobre
   * JSON.stringify(body) en vez del body crudo byte-exacto — una integración
   * real necesitaría un raw-body parser dedicado para esa ruta.
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
