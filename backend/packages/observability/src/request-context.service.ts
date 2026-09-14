import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

export interface RequestContext {
  correlationId: string;
  transactionId?: string;
}

/**
 * Wrapper de AsyncLocalStorage: guarda { correlationId, transactionId } una vez
 * por request/mensaje y lo deja disponible en toda la cadena async subsiguiente
 * (logger, clientes HTTP salientes, producers de Kafka/RabbitMQ) sin pasarlo
 * manualmente por parámetro en cada función.
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

  /** Actualiza el transactionId del contexto activo (ej. una vez resuelto desde un webhook). */
  setTransactionId(transactionId: string): void {
    const store = this.als.getStore();
    if (store) {
      store.transactionId = transactionId;
    }
  }
}
