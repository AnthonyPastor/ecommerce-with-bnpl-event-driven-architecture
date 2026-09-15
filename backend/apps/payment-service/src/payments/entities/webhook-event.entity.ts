import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * Idempotency for incoming webhooks: (gateway, externalEventId) is unique —
 * if the gateway retries delivery of the same event, the second attempt
 * is detected here and not processed again.
 */
@Entity('webhook_events')
@Unique(['gateway', 'externalEventId'])
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  gateway!: string;

  @Index()
  @Column({ name: 'external_event_id' })
  externalEventId!: string;

  @Column({ name: 'transaction_id' })
  transactionId!: string;

  @Column({ name: 'event_type' })
  eventType!: string;

  @Column({ name: 'raw_payload', type: 'jsonb' })
  rawPayload!: Record<string, unknown>;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
