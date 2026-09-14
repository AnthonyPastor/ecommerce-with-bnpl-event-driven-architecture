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
 * Puerto abstracto del payment gateway — repository pattern para poder
 * swappear la implementación (fake -> MercadoPago/PayPal) sin tocar
 * PaymentsService ni el resto del sistema. DI vía token explícito
 * (PAYMENT_GATEWAY), useFactory leyendo PAYMENT_GATEWAY_PROVIDER de env.
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
