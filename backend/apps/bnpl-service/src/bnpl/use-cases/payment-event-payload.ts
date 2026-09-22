import { PaymentMethod } from '@bnpl/event-contracts';

export interface PaymentEventPayload {
  transactionId: string;
  orderId: string;
  userId: string;
  amountCents: number;
  currency: string;
  /** Only present on `payment.transaction.captured.v1` — absent on refund/chargeback events. */
  paymentMethod?: PaymentMethod;
  /** Only present on `payment.installment_charge.captured.v1` / `.capture_failed.v1`. */
  installmentId?: string;
}
