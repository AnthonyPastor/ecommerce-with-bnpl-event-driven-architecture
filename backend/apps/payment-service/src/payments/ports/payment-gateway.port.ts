export interface AuthorizeInput {
  transactionId: string;
  amountCents: number;
  currency: string;
}

export interface AuthorizeResult {
  gatewayReference: string;
}

export interface CaptureInput {
  transactionId: string;
  gatewayReference: string;
  amountCents: number;
}

export interface CaptureResult {
  gatewayReference: string;
}

export interface RefundInput {
  transactionId: string;
  gatewayReference: string;
  amountCents: number;
}

export interface RefundResult {
  gatewayReference: string;
}

export interface VoidInput {
  transactionId: string;
  gatewayReference: string;
}

export interface VoidResult {
  gatewayReference: string;
}

export type NormalizedWebhookEventType =
  | 'capture_succeeded'
  | 'capture_failed'
  | 'refund_succeeded'
  | 'refund_failed'
  | 'dispute_opened'
  | 'chargeback';

export interface NormalizedWebhookEvent {
  externalEventId: string;
  gatewayReference: string;
  eventType: NormalizedWebhookEventType;
  amountCents?: number;
}

/**
 * Abstract port for the payment gateway — repository pattern so the
 * implementation can be swapped (fake -> MercadoPago/PayPal) without touching
 * PaymentsService or the rest of the system. DI via an explicit token
 * (PAYMENT_GATEWAY), useFactory reading PAYMENT_GATEWAY_PROVIDER from env.
 */
export abstract class PaymentGatewayPort {
  abstract authorize(input: AuthorizeInput): Promise<AuthorizeResult>;
  abstract capture(input: CaptureInput): Promise<CaptureResult>;
  abstract refund(input: RefundInput): Promise<RefundResult>;
  abstract void(input: VoidInput): Promise<VoidResult>;
  abstract verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string>): boolean;
  abstract parseWebhookPayload(rawBody: Buffer, headers: Record<string, string>): NormalizedWebhookEvent;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
