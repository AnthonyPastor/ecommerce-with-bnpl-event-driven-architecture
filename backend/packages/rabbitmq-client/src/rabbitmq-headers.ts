export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const TRANSACTION_ID_HEADER = 'x-transaction-id';
export const RETRY_COUNT_HEADER = 'x-retry-count';

export interface CommandContext {
  correlationId: string;
  transactionId?: string;
}

function headerToString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Buffer.isBuffer(value)) return value.toString();
  return String(value);
}

export function buildCommandHeaders(ctx: CommandContext): Record<string, string> {
  const headers: Record<string, string> = { [CORRELATION_ID_HEADER]: ctx.correlationId };
  if (ctx.transactionId) headers[TRANSACTION_ID_HEADER] = ctx.transactionId;
  return headers;
}

export function headersToContext(headers: Record<string, unknown> | undefined): CommandContext {
  const correlationId = headerToString(headers?.[CORRELATION_ID_HEADER]) ?? 'unknown';
  const transactionId = headerToString(headers?.[TRANSACTION_ID_HEADER]);
  return { correlationId, transactionId };
}

export function getRetryCount(headers: Record<string, unknown> | undefined): number {
  const raw = headerToString(headers?.[RETRY_COUNT_HEADER]);
  return raw ? Number(raw) : 0;
}
