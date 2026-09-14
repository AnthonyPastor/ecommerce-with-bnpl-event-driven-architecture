import { PAYMENT_TRANSITIONS, PaymentStatus } from '@bnpl/event-contracts';
import { UnprocessableEntityException } from '@nestjs/common';

export { PAYMENT_TRANSITIONS, PaymentStatus };

/** Lanza si `from -> to` no es una transición válida según PAYMENT_TRANSITIONS. */
export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  const allowed = PAYMENT_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new UnprocessableEntityException(`Invalid payment transition: ${from} -> ${to}`);
  }
}
