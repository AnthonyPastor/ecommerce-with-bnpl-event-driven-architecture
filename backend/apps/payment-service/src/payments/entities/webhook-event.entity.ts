import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * Idempotencia de webhooks entrantes: (gateway, externalEventId) es único —
 * si el gateway reintenta la entrega del mismo evento, el segundo intento
 * se detecta acá y no se vuelve a procesar.
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
