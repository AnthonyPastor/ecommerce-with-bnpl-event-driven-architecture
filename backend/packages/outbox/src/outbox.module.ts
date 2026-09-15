import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEvent } from './outbox-event.entity';
import { OutboxPublisherService } from './outbox-publisher.service';
import { OUTBOX_POLL_INTERVAL_MS, OUTBOX_PRODUCER_NAME } from './outbox.constants';

export interface OutboxModuleOptions {
  /** Name of the service that appears in `envelope.producer` (e.g. 'order-service'). */
  producerName: string;
  pollIntervalMs?: number;
}

@Module({})
export class OutboxModule {
  static forFeature(options: OutboxModuleOptions): DynamicModule {
    return {
      module: OutboxModule,
      imports: [TypeOrmModule.forFeature([OutboxEvent])],
      providers: [
        { provide: OUTBOX_PRODUCER_NAME, useValue: options.producerName },
        { provide: OUTBOX_POLL_INTERVAL_MS, useValue: options.pollIntervalMs ?? 500 },
        OutboxPublisherService,
      ],
      exports: [TypeOrmModule],
    };
  }
}
