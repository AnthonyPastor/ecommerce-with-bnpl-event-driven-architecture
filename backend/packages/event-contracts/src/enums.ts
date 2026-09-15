export enum PaymentStatus {
  PENDING = 'PENDING',
  AUTHORIZED = 'AUTHORIZED',
  AUTHORIZATION_FAILED = 'AUTHORIZATION_FAILED',
  CAPTURED = 'CAPTURED',
  CAPTURE_FAILED = 'CAPTURE_FAILED',
  VOIDED = 'VOIDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  REFUNDED = 'REFUNDED',
  DISPUTED = 'DISPUTED',
  CHARGEBACK = 'CHARGEBACK',
  CANCELLED = 'CANCELLED',
}

/** Map of valid transitions for the Payment/Transaction state machine. */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [
    PaymentStatus.AUTHORIZED,
    PaymentStatus.AUTHORIZATION_FAILED,
    PaymentStatus.CANCELLED,
  ],
  [PaymentStatus.AUTHORIZED]: [
    PaymentStatus.CAPTURED,
    PaymentStatus.CAPTURE_FAILED,
    PaymentStatus.VOIDED,
  ],
  [PaymentStatus.CAPTURED]: [
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.REFUNDED,
    PaymentStatus.DISPUTED,
  ],
  [PaymentStatus.PARTIALLY_REFUNDED]: [
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.REFUNDED,
    PaymentStatus.DISPUTED,
  ],
  [PaymentStatus.DISPUTED]: [PaymentStatus.CHARGEBACK, PaymentStatus.CAPTURED],
  [PaymentStatus.AUTHORIZATION_FAILED]: [],
  [PaymentStatus.CAPTURE_FAILED]: [],
  [PaymentStatus.VOIDED]: [],
  [PaymentStatus.REFUNDED]: [],
  [PaymentStatus.CHARGEBACK]: [],
  [PaymentStatus.CANCELLED]: [],
};

export enum InstallmentPlanStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  ADJUSTED = 'ADJUSTED',
  CANCELLED = 'CANCELLED',
  DISPUTED_HOLD = 'DISPUTED_HOLD',
}

export enum InstallmentStatus {
  PENDING = 'PENDING',
  DUE = 'DUE',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  DEFAULTED = 'DEFAULTED',
  CANCELLED = 'CANCELLED',
}

export enum OrderStatus {
  CREATED = 'CREATED',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}
