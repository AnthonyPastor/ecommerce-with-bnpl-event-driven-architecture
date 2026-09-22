import { RabbitMqTopology } from '@bnpl/event-contracts';
import { RABBITMQ_CHANNEL, RabbitMqConsumerService, bindRetryTopology } from '@bnpl/rabbitmq-client';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Channel } from 'amqplib';
import { PaymentsService } from './payments.service';

export interface ChargeInstallmentCommand {
  installmentId: string;
  planId: string;
  orderId: string;
  userId: string;
  amountCents: number;
  currency: string;
  attempt: number;
}

/**
 * Consumes bnpl-service's `payment.charge_installment` command — the queue
 * was defined in `RabbitMqTopology` from day one but nothing published or
 * consumed it until bnpl-service's installment poller existed. Mirrors
 * `WebhookProcessorConsumer`'s shape exactly.
 */
@Injectable()
export class InstallmentChargeConsumer implements OnModuleInit {
  private readonly logger = new Logger(InstallmentChargeConsumer.name);

  constructor(
    @Inject(RABBITMQ_CHANNEL) private readonly channel: Channel,
    private readonly rabbitConsumer: RabbitMqConsumerService,
    private readonly paymentsService: PaymentsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await bindRetryTopology(this.channel, {
      exchange: RabbitMqTopology.exchange,
      routingKey: RabbitMqTopology.routingKeys.paymentChargeInstallment,
      queue: RabbitMqTopology.queues.paymentsChargeInstallment,
      retryDelayMs: 5000,
    });

    await this.rabbitConsumer.subscribe<ChargeInstallmentCommand>(
      RabbitMqTopology.queues.paymentsChargeInstallment,
      async (command) => {
        await this.paymentsService.chargeInstallment({
          installmentId: command.installmentId,
          orderId: command.orderId,
          userId: command.userId,
          amountCents: command.amountCents,
          currency: command.currency,
        });
        this.logger.log(`Processed installment charge command for installment ${command.installmentId} (attempt ${command.attempt})`);
      },
      { maxRetries: 3 },
    );
  }
}
