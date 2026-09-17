import { OrderStatus, PaymentMethod } from '@bnpl/event-contracts';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrderItem } from './order-item.entity';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', default: OrderStatus.CREATED })
  status!: OrderStatus;

  /** Set only once the order is CONFIRMED (from the `payment.transaction.captured.v1` payload) — drives the computed `paymentStatus` in OrdersService. */
  @Column({ name: 'payment_method', type: 'varchar', nullable: true })
  paymentMethod!: PaymentMethod | null;

  @Column({ name: 'total_cents', type: 'int' })
  totalCents!: number;

  @Column({ default: 'USD' })
  currency!: string;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items!: OrderItem[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
