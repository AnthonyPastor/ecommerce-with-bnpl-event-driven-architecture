import { PAYMENT_TRANSITIONS, PaymentStatus } from '@bnpl/event-contracts';
import { UnprocessableEntityException } from '@nestjs/common';

export { PAYMENT_TRANSITIONS, PaymentStatus };

/** Throws if `from -> to` is not a valid transition per PAYMENT_TRANSITIONS. */
export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  const allowed = PAYMENT_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new UnprocessableEntityException(`Invalid payment transition: ${from} -> ${to}`);
  }
}
