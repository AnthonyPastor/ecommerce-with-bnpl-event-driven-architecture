import { RabbitMqTopology } from '@bnpl/event-contracts';
import { RABBITMQ_CHANNEL, RabbitMqConsumerService, bindRetryTopology } from '@bnpl/rabbitmq-client';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Channel } from 'amqplib';
import { Repository } from 'typeorm';
import { WebhookEvent } from './entities/webhook-event.entity';
import { PaymentsService } from './payments.service';
import { WebhookCommandPayload } from './webhooks.controller';

@Injectable()
export class WebhookProcessorConsumer implements OnModuleInit {
  private readonly logger = new Logger(WebhookProcessorConsumer.name);

  constructor(
    @Inject(RABBITMQ_CHANNEL) private readonly channel: Channel,
    private readonly rabbitConsumer: RabbitMqConsumerService,
    private readonly paymentsService: PaymentsService,
    @InjectRepository(WebhookEvent) private readonly webhookEvents: Repository<WebhookEvent>,
  ) {}

  async onModuleInit(): Promise<void> {
    await bindRetryTopology(this.channel, {
      exchange: RabbitMqTopology.exchange,
      routingKey: RabbitMqTopology.routingKeys.webhookPaymentProcess,
      queue: RabbitMqTopology.queues.paymentsWebhookProcess,
      retryDelayMs: 5000,
    });

    await this.rabbitConsumer.subscribe<WebhookCommandPayload>(
      RabbitMqTopology.queues.paymentsWebhookProcess,
      async (command) => {
        const record = await this.webhookEvents.findOne({
          where: { gateway: command.gateway, externalEventId: command.normalized.externalEventId },
        });
        if (record?.processedAt) {
          this.logger.log(
            `Webhook ${command.normalized.eventType} for transaction ${command.transactionId} already processed, ignoring redelivery`,
          );
          return;
        }

        await this.paymentsService.processWebhookEvent(command.transactionId, command.normalized);
        await this.webhookEvents.update(
          { gateway: command.gateway, externalEventId: command.normalized.externalEventId },
          { processedAt: new Date() },
        );
        this.logger.log(
          `Processed webhook ${command.normalized.eventType} for transaction ${command.transactionId}`,
        );
      },
      { maxRetries: 3 },
    );
  }
}
