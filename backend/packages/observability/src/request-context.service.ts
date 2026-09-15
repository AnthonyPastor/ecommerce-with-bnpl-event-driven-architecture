import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

export interface RequestContext {
  correlationId: string;
  transactionId?: string;
}

/**
 * AsyncLocalStorage wrapper: stores { correlationId, transactionId } once per
 * request/message and makes it available throughout the subsequent async
 * chain (logger, outbound HTTP clients, Kafka/RabbitMQ producers) without
 * manually passing it as a parameter through every function.
 */
@Injectable()
export class RequestContextService {
  private readonly als = new AsyncLocalStorage<RequestContext>();

  run<T>(context: RequestContext, fn: () => T): T {
    return this.als.run(context, fn);
  }

  get(): RequestContext | undefined {
    return this.als.getStore();
  }

  getCorrelationId(): string | undefined {
    return this.als.getStore()?.correlationId;
  }

  getTransactionId(): string | undefined {
    return this.als.getStore()?.transactionId;
  }

  /** Updates the transactionId of the active context (e.g. once resolved from a webhook). */
  setTransactionId(transactionId: string): void {
    const store = this.als.getStore();
    if (store) {
      store.transactionId = transactionId;
    }
  }
}
