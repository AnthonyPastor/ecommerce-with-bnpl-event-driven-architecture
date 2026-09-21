import { InstallmentStatus } from '@bnpl/event-contracts';
import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { InstallmentPlan } from './installment-plan.entity';

@Entity('installments')
export class Installment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => InstallmentPlan, (plan) => plan.installments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan!: InstallmentPlan;

  @Column({ name: 'installment_number', type: 'int' })
  installmentNumber!: number;

  @Column({ name: 'amount_cents', type: 'int' })
  amountCents!: number;

  /** `amountCents` at creation time, before any partial-refund adjustment — the base a refund factor is always applied against, so repeated adjustments don't compound. */
  @Column({ name: 'original_amount_cents', type: 'int' })
  originalAmountCents!: number;

  @Column({ name: 'due_date', type: 'timestamptz' })
  dueDate!: Date;

  @Column({ type: 'varchar' })
  status!: InstallmentStatus;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount!: number;
}
