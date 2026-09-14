import type { EventEnvelope } from '@bnpl/event-contracts';
import type { IHeaders } from 'kafkajs';

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const TRANSACTION_ID_HEADER = 'x-transaction-id';
export const CAUSATION_ID_HEADER = 'x-causation-id';
export const EVENT_TYPE_HEADER = 'x-event-type';
export const EVENT_ID_HEADER = 'x-event-id';

/**
 * correlationId/transactionId/causationId van TAMBIÉN como headers del mensaje
 * (redundante a propósito respecto del envelope) para poder filtrar/propagar
 * sin deserializar el payload.
 */
export function envelopeToHeaders(envelope: EventEnvelope): IHeaders {
  const headers: IHeaders = {
    [EVENT_ID_HEADER]: envelope.eventId,
    [EVENT_TYPE_HEADER]: envelope.eventType,
    [CORRELATION_ID_HEADER]: envelope.correlationId,
  };
  if (envelope.transactionId) headers[TRANSACTION_ID_HEADER] = envelope.transactionId;
  if (envelope.causationId) headers[CAUSATION_ID_HEADER] = envelope.causationId;
  return headers;
}

export interface ExtractedContext {
  correlationId: string;
  transactionId?: string;
}

function headerToString(value: IHeaders[string]): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0]?.toString() : value.toString();
}

/** Extrae correlationId/transactionId de los headers crudos de un mensaje Kafka recibido. */
export function headersToContext(headers: IHeaders | undefined): ExtractedContext {
  const correlationId = headerToString(headers?.[CORRELATION_ID_HEADER]) ?? 'unknown';
  const transactionId = headerToString(headers?.[TRANSACTION_ID_HEADER]);
  return { correlationId, transactionId };
}
