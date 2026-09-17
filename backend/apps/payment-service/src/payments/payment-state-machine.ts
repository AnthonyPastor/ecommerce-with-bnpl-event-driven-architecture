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

/**
 * A status is terminal when `PAYMENT_TRANSITIONS` has no outgoing transitions
 * for it. Derived from the shared state machine (not hand-maintained) so it
 * can never drift from it — a terminal transaction can't block a retry, an
 * in-flight one always should.
 */
export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return (PAYMENT_TRANSITIONS[status] ?? []).length === 0;
}
