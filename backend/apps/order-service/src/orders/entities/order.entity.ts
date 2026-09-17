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

  /**
   * Mirrors the latest non-terminal-for-us payment health signal from
   * payment-service (dispute opened, chargeback, partial refund) — payment
   * state can keep moving after CONFIRMED, and `status` alone can't reflect
   * that. Cleared back to null by a full refund. Drives `paymentStatus` in
   * OrdersService alongside `status`/`paymentMethod`.
   */
  @Column({ name: 'payment_incident', type: 'varchar', nullable: true })
  paymentIncident!: 'PARTIALLY_REFUNDED' | 'DISPUTED' | 'CHARGEBACK' | null;

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
