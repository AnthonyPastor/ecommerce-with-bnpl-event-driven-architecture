import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Order } from './order.entity';

@Entity('order_status_history')
export class OrderStatusHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order!: Order;

  @Column({ name: 'from_status', type: 'varchar', nullable: true })
  fromStatus!: string | null;

  @Column({ name: 'to_status' })
  toStatus!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
