import { UnprocessableEntityException } from '@nestjs/common';
import { PaymentStatus, assertTransition } from './payment-state-machine';

describe('assertTransition', () => {
  it('allows every transition listed in PAYMENT_TRANSITIONS', () => {
    expect(() => assertTransition(PaymentStatus.PENDING, PaymentStatus.AUTHORIZED)).not.toThrow();
    expect(() => assertTransition(PaymentStatus.AUTHORIZED, PaymentStatus.CAPTURED)).not.toThrow();
    expect(() => assertTransition(PaymentStatus.CAPTURED, PaymentStatus.REFUNDED)).not.toThrow();
    expect(() => assertTransition(PaymentStatus.CAPTURED, PaymentStatus.DISPUTED)).not.toThrow();
    expect(() => assertTransition(PaymentStatus.DISPUTED, PaymentStatus.CHARGEBACK)).not.toThrow();
  });

  it('rejects skipping states (PENDING -> CAPTURED)', () => {
    expect(() => assertTransition(PaymentStatus.PENDING, PaymentStatus.CAPTURED)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('rejects any transition out of a terminal state', () => {
    expect(() => assertTransition(PaymentStatus.REFUNDED, PaymentStatus.CAPTURED)).toThrow(
      UnprocessableEntityException,
    );
    expect(() => assertTransition(PaymentStatus.CANCELLED, PaymentStatus.AUTHORIZED)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('rejects going backwards (CAPTURED -> AUTHORIZED)', () => {
    expect(() => assertTransition(PaymentStatus.CAPTURED, PaymentStatus.AUTHORIZED)).toThrow();
  });
});
