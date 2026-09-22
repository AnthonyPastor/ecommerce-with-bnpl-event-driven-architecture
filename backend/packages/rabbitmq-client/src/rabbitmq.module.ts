import { RequestContextModule } from '@bnpl/observability';
import { DynamicModule, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import * as amqplib from 'amqplib';
import { RabbitMqConsumerService } from './rabbitmq-consumer.service';
import { RabbitMqPublisherService } from './rabbitmq-publisher.service';
import { RABBITMQ_CHANNEL, RABBITMQ_CONNECTION } from './rabbitmq.constants';

export interface RabbitMqModuleOptions {
  url: string;
}

/**
 * Neither the channel nor the connection were ever closed on shutdown —
 * an open amqplib TCP socket keeps the Node event loop alive indefinitely,
 * so `app.close()` (and any e2e suite's `afterAll`) would hang forever
 * instead of exiting. Implementing `OnModuleDestroy` on the module class
 * itself (not a separate provider) lets it inject its own registered
 * RABBITMQ_CHANNEL/RABBITMQ_CONNECTION providers via constructor, same as
 * any other provider would.
 */
@Module({})
export class RabbitMqModule implements OnModuleDestroy {
  constructor(
    @Inject(RABBITMQ_CHANNEL) private readonly channel: amqplib.Channel,
    @Inject(RABBITMQ_CONNECTION) private readonly connection: amqplib.ChannelModel,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.channel.close().catch(() => undefined);
    await this.connection.close().catch(() => undefined);
  }

  static forRoot(options: RabbitMqModuleOptions): DynamicModule {
    return {
      module: RabbitMqModule,
      imports: [RequestContextModule],
      providers: [
        {
          provide: RABBITMQ_CONNECTION,
          useFactory: () => amqplib.connect(options.url),
        },
        {
          provide: RABBITMQ_CHANNEL,
          useFactory: async (connection: amqplib.ChannelModel) => connection.createChannel(),
          inject: [RABBITMQ_CONNECTION],
        },
        RabbitMqPublisherService,
        RabbitMqConsumerService,
      ],
      exports: [RabbitMqPublisherService, RabbitMqConsumerService, RABBITMQ_CHANNEL],
      global: true,
    };
  }
}
