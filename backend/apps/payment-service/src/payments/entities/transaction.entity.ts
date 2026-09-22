import { PaymentMethod, PaymentStatus } from '@bnpl/event-contracts';
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('transactions')
export class Transaction {
  @PrimaryColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'order_id' })
  orderId!: string;

  @Index()
  @Column({ name: 'user_id' })
  userId!: string;

  /** Set only for a Transaction that charges one bnpl-service Installment rather than the order's original payment — see `PaymentsService.chargeInstallment()`. */
  @Index()
  @Column({ name: 'installment_id', type: 'varchar', nullable: true })
  installmentId!: string | null;

  @Column({ name: 'amount_cents', type: 'int' })
  amountCents!: number;

  @Column({ default: 'USD' })
  currency!: string;

  @Column({ type: 'varchar' })
  status!: PaymentStatus;

  @Column({ name: 'payment_method', type: 'varchar', default: PaymentMethod.INSTALLMENTS })
  paymentMethod!: PaymentMethod;

  @Column({ name: 'gateway_provider' })
  gatewayProvider!: string;

  @Column({ name: 'gateway_reference', type: 'varchar', nullable: true })
  gatewayReference!: string | null;

  /** Suma acumulada ya reembolsada — permite distinguir refund total de parcial y soportar reembolsos parciales sucesivos. */
  @Column({ name: 'refunded_amount_cents', type: 'int', default: 0 })
  refundedAmountCents!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
