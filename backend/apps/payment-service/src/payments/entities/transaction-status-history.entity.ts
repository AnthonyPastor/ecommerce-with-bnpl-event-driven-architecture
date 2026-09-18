import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Transaction } from './transaction.entity';

@Entity('transaction_status_history')
export class TransactionStatusHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Transaction, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'transaction_id' })
  transaction!: Transaction;

  @Column({ name: 'from_status', type: 'varchar', nullable: true })
  fromStatus!: string | null;

  @Column({ name: 'to_status' })
  toStatus!: string;

  /** 'sync' = triggered by the checkout (authorize/capture); 'webhook' = async confirmation from the gateway. */
  @Column({ type: 'varchar' })
  source!: 'sync' | 'webhook';

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
