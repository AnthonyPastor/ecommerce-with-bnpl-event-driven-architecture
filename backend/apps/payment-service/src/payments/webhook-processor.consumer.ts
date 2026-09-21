import { RabbitMqTopology } from '@bnpl/event-contracts';
import { RABBITMQ_CHANNEL, RabbitMqConsumerService, bindRetryTopology } from '@bnpl/rabbitmq-client';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { Channel } from 'amqplib';
import { DataSource, Repository } from 'typeorm';
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
    @InjectDataSource() private readonly dataSource: DataSource,
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
        const claimed = await this.claimWebhookEvent(command.gateway, command.normalized.externalEventId);
        if (!claimed) {
          this.logger.log(
            `Webhook ${command.normalized.eventType} for transaction ${command.transactionId} already processed, ignoring redelivery`,
          );
          return;
        }

        try {
          await this.paymentsService.processWebhookEvent(command.transactionId, command.normalized);
        } catch (err) {
          // Release the claim so a genuine retry (RabbitMQ redelivery after
          // this throw) can reprocess instead of being skipped as "already processed".
          await this.webhookEvents.update(
            { gateway: command.gateway, externalEventId: command.normalized.externalEventId },
            { processedAt: null },
          );
          throw err;
        }
        this.logger.log(
          `Processed webhook ${command.normalized.eventType} for transaction ${command.transactionId}`,
        );
      },
      { maxRetries: 3 },
    );
  }

  /**
   * Atomically claims a webhook event for processing: locks the row and only
   * marks it processed if it isn't already. A plain check-then-update (SELECT
   * then UPDATE as two separate statements) lets two overlapping redeliveries
   * of the same message both pass the check before either commits — the row
   * lock here serializes them, so the second delivery observes the first
   * claim's `processedAt` and returns false instead of double-processing.
   */
  private async claimWebhookEvent(gateway: string, externalEventId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const record = await manager.findOne(WebhookEvent, {
        where: { gateway, externalEventId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!record || record.processedAt) {
        return false;
      }
      record.processedAt = new Date();
      await manager.save(record);
      return true;
    });
  }
}
