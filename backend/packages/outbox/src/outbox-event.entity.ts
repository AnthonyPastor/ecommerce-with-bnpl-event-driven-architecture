import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Fila del transactional outbox: se escribe en la MISMA transacción SQL que
 * la entidad de dominio que la origina (ver saveWithOutbox), y un proceso
 * aparte (OutboxPublisherService) la publica a Kafka y marca publishedAt.
 */
@Entity('outbox_events')
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'aggregate_type' })
  aggregateType!: string;

  @Index()
  @Column({ name: 'aggregate_id' })
  aggregateId!: string;

  @Column({ name: 'event_type' })
  eventType!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'correlation_id' })
  correlationId!: string;

  @Column({ name: 'transaction_id', type: 'varchar', nullable: true })
  transactionId!: string | null;

  @Column({ name: 'causation_id', type: 'varchar', nullable: true })
  causationId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Index()
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;
}
