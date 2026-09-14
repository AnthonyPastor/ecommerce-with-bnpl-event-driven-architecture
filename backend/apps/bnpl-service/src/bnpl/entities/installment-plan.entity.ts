import { InstallmentPlanStatus } from '@bnpl/event-contracts';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Installment } from './installment.entity';

@Entity('installment_plans')
export class InstallmentPlan {
  @PrimaryColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'order_id' })
  orderId!: string;

  @Index()
  @Column({ name: 'user_id' })
  userId!: string;

  /** id de la Transaction de payment-service que financió esta orden. */
  @Column({ name: 'transaction_id' })
  transactionId!: string;

  @Column({ name: 'total_cents', type: 'int' })
  totalCents!: number;

  @Column({ default: 'USD' })
  currency!: string;

  @Column({ name: 'installments_count', type: 'int' })
  installmentsCount!: number;

  @Column({ type: 'varchar' })
  status!: InstallmentPlanStatus;

  @OneToMany(() => Installment, (installment) => installment.plan, { cascade: true })
  installments!: Installment[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
