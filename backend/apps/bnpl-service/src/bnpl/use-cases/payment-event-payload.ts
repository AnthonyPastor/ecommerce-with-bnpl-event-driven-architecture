import { PaymentMethod } from '@bnpl/event-contracts';

export interface PaymentEventPayload {
  transactionId: string;
  orderId: string;
  userId: string;
  amountCents: number;
  currency: string;
  /** Only present on `payment.transaction.captured.v1` — absent on refund/chargeback events. */
  paymentMethod?: PaymentMethod;
}
