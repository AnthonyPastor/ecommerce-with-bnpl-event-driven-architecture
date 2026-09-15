import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestContextService } from './request-context.service';

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const TRANSACTION_ID_HEADER = 'x-transaction-id';

/**
 * Takes (or generates) the correlationId/transactionId from the incoming
 * request, runs the rest of the pipeline inside RequestContextService's
 * context, and returns them on the response so the caller can log them.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId = this.headerValue(req, CORRELATION_ID_HEADER) ?? randomUUID();
    const transactionId = this.headerValue(req, TRANSACTION_ID_HEADER);

    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    if (transactionId) {
      res.setHeader(TRANSACTION_ID_HEADER, transactionId);
    }

    this.requestContext.run({ correlationId, transactionId }, () => next());
  }

  private headerValue(req: Request, name: string): string | undefined {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }
}
