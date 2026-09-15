import { PAYMENT_TRANSITIONS, PaymentStatus } from '../../src/enums';

describe('PAYMENT_TRANSITIONS', () => {
  it('allows the happy path PENDING -> AUTHORIZED -> CAPTURED -> REFUNDED', () => {
    expect(PAYMENT_TRANSITIONS[PaymentStatus.PENDING]).toContain(PaymentStatus.AUTHORIZED);
    expect(PAYMENT_TRANSITIONS[PaymentStatus.AUTHORIZED]).toContain(PaymentStatus.CAPTURED);
    expect(PAYMENT_TRANSITIONS[PaymentStatus.CAPTURED]).toContain(PaymentStatus.REFUNDED);
  });

  it('allows the non-happy paths: partial refund, dispute and chargeback', () => {
    expect(PAYMENT_TRANSITIONS[PaymentStatus.CAPTURED]).toContain(PaymentStatus.PARTIALLY_REFUNDED);
    expect(PAYMENT_TRANSITIONS[PaymentStatus.CAPTURED]).toContain(PaymentStatus.DISPUTED);
    expect(PAYMENT_TRANSITIONS[PaymentStatus.DISPUTED]).toContain(PaymentStatus.CHARGEBACK);
    expect(PAYMENT_TRANSITIONS[PaymentStatus.PARTIALLY_REFUNDED]).toContain(
      PaymentStatus.PARTIALLY_REFUNDED,
    );
  });

  it('does not allow skipping straight from PENDING to CAPTURED', () => {
    expect(PAYMENT_TRANSITIONS[PaymentStatus.PENDING]).not.toContain(PaymentStatus.CAPTURED);
  });

  it('treats terminal states as having no outgoing transitions', () => {
    for (const terminal of [
      PaymentStatus.AUTHORIZATION_FAILED,
      PaymentStatus.CAPTURE_FAILED,
      PaymentStatus.VOIDED,
      PaymentStatus.REFUNDED,
      PaymentStatus.CHARGEBACK,
      PaymentStatus.CANCELLED,
    ]) {
      expect(PAYMENT_TRANSITIONS[terminal]).toHaveLength(0);
    }
  });

  it('defines transitions for every PaymentStatus value', () => {
    const allStatuses = Object.values(PaymentStatus);
    for (const status of allStatuses) {
      expect(PAYMENT_TRANSITIONS[status]).toBeDefined();
    }
  });
});
