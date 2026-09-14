import { RequestContextModule } from '@bnpl/observability';
import { DynamicModule, Module } from '@nestjs/common';
import * as amqplib from 'amqplib';
import { RabbitMqConsumerService } from './rabbitmq-consumer.service';
import { RabbitMqPublisherService } from './rabbitmq-publisher.service';
import { RABBITMQ_CHANNEL, RABBITMQ_CONNECTION } from './rabbitmq.constants';

export interface RabbitMqModuleOptions {
  url: string;
}

@Module({})
export class RabbitMqModule {
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
