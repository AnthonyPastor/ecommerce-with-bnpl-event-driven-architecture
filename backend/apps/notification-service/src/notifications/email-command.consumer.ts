import { RabbitMqTopology } from '@bnpl/event-contracts';
import { RABBITMQ_CHANNEL, RabbitMqConsumerService, bindRetryTopology } from '@bnpl/rabbitmq-client';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Channel } from 'amqplib';
import { Repository } from 'typeorm';
import { NotificationLog } from './entities/notification-log.entity';
import { EMAIL_PROVIDER, EmailProviderPort } from './ports/email-provider.port';
import { SendEmailCommand } from './send-email.command';

@Injectable()
export class EmailCommandConsumer implements OnModuleInit {
  private readonly logger = new Logger(EmailCommandConsumer.name);

  constructor(
    @Inject(RABBITMQ_CHANNEL) private readonly channel: Channel,
    private readonly rabbitConsumer: RabbitMqConsumerService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProviderPort,
    @InjectRepository(NotificationLog) private readonly logs: Repository<NotificationLog>,
  ) {}

  async onModuleInit(): Promise<void> {
    await bindRetryTopology(this.channel, {
      exchange: RabbitMqTopology.exchange,
      routingKey: RabbitMqTopology.routingKeys.emailSend,
      queue: RabbitMqTopology.queues.notificationsEmailSend,
      retryDelayMs: 5000,
    });

    await this.rabbitConsumer.subscribe<SendEmailCommand>(
      RabbitMqTopology.queues.notificationsEmailSend,
      async (command) => {
        await this.emailProvider.send(command);
        await this.logs.save(
          this.logs.create({ to: command.to, template: command.template, data: command.data, sentAt: new Date() }),
        );
        this.logger.log(`Sent "${command.template}" to ${command.to}`);
      },
      { maxRetries: 3 },
    );
  }
}
