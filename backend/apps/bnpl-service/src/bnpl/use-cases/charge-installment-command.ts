/** Wire shape of the `payment.charge_installment` RabbitMQ command this service publishes. payment-service declares its own matching copy (`ChargeInstallmentCommand` in `installment-charge.consumer.ts`) — no cross-service imports, per this monorepo's convention. */
export interface ChargeInstallmentCommand {
  installmentId: string;
  planId: string;
  orderId: string;
  userId: string;
  amountCents: number;
  currency: string;
  attempt: number;
}
