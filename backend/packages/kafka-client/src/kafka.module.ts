import { RequestContextModule } from '@bnpl/observability';
import { DynamicModule, Module } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import { KAFKA_CLIENT, KAFKA_CLIENT_ID, KAFKA_GROUP_ID } from './kafka.constants';
import { KafkaConsumerService } from './kafka-consumer.service';
import { KafkaProducerService } from './kafka-producer.service';

export interface KafkaModuleOptions {
  brokers: string[];
  clientId: string;
  /** groupId por defecto para KafkaConsumerService.subscribe() cuando no se pasa uno explícito. */
  groupId: string;
}

@Module({})
export class KafkaModule {
  static forRoot(options: KafkaModuleOptions): DynamicModule {
    return {
      module: KafkaModule,
      imports: [RequestContextModule],
      providers: [
        {
          provide: KAFKA_CLIENT,
          useValue: new Kafka({ clientId: options.clientId, brokers: options.brokers }),
        },
        { provide: KAFKA_CLIENT_ID, useValue: options.clientId },
        { provide: KAFKA_GROUP_ID, useValue: options.groupId },
        KafkaProducerService,
        KafkaConsumerService,
      ],
      exports: [KafkaProducerService, KafkaConsumerService],
      global: true,
    };
  }
}
