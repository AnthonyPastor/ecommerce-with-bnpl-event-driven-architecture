import type { EventEnvelope } from '@bnpl/event-contracts';
import { KafkaProducerService } from '@bnpl/kafka-client';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { OutboxEvent } from './outbox-event.entity';
import { OUTBOX_POLL_INTERVAL_MS, OUTBOX_PRODUCER_NAME } from './outbox.constants';

@Injectable()
export class OutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    @InjectRepository(OutboxEvent) private readonly repo: Repository<OutboxEvent>,
    private readonly kafkaProducer: KafkaProducerService,
    @Inject(OUTBOX_PRODUCER_NAME) private readonly producerName: string,
    @Inject(OUTBOX_POLL_INTERVAL_MS) private readonly pollIntervalMs: number,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.publishPending().catch((err: Error) =>
        this.logger.error(`Outbox publish loop failed: ${err.message}`),
      );
    }, this.pollIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Publishes up to 50 pending rows. Returns how many it published (for tests/debug). */
  async publishPending(): Promise<number> {
    const pending = await this.repo.find({
      where: { publishedAt: IsNull() },
      order: { createdAt: 'ASC' },
      take: 50,
    });

    for (const row of pending) {
      const envelope: EventEnvelope = {
        eventId: row.id,
        eventType: row.eventType,
        version: 1,
        occurredAt: row.createdAt.toISOString(),
        correlationId: row.correlationId,
        transactionId: row.transactionId ?? undefined,
        causationId: row.causationId ?? undefined,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        producer: this.producerName,
        payload: row.payload,
      };

      await this.kafkaProducer.publish(envelope);
      row.publishedAt = new Date();
      await this.repo.save(row);
    }

    return pending.length;
  }
}
