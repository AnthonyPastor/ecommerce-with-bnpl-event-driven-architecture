import { HttpModule, HttpService } from '@nestjs/axios';
import { Injectable, Module } from '@nestjs/common';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { Observable } from 'rxjs';
import { CORRELATION_ID_HEADER, TRANSACTION_ID_HEADER } from './correlation-id.middleware';
import { RequestContextModule } from './request-context.module';
import { RequestContextService } from './request-context.service';

/**
 * Wrapper de HttpService que, en cada llamada saliente entre servicios, toma
 * correlationId/transactionId del contexto activo y los setea como headers
 * salientes — así un webhook entrante en un request nuevo recupera el mismo
 * transactionId que el resto del flujo, y el correlationId se propaga sin
 * que cada caller tenga que acordarse de pasarlo.
 */
@Injectable()
export class PropagatingHttpService {
  constructor(
    private readonly http: HttpService,
    private readonly requestContext: RequestContextService,
  ) {}

  get<T = unknown>(url: string, config?: AxiosRequestConfig): Observable<AxiosResponse<T>> {
    return this.http.get<T>(url, this.withPropagatedHeaders(config));
  }

  post<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Observable<AxiosResponse<T>> {
    return this.http.post<T>(url, data, this.withPropagatedHeaders(config));
  }

  private withPropagatedHeaders(config?: AxiosRequestConfig): AxiosRequestConfig {
    const ctx = this.requestContext.get();
    if (!ctx) {
      return config ?? {};
    }
    return {
      ...config,
      headers: {
        ...config?.headers,
        [CORRELATION_ID_HEADER]: ctx.correlationId,
        ...(ctx.transactionId ? { [TRANSACTION_ID_HEADER]: ctx.transactionId } : {}),
      },
    };
  }
}

@Module({
  imports: [HttpModule, RequestContextModule],
  providers: [PropagatingHttpService],
  exports: [PropagatingHttpService],
})
export class PropagatingHttpModule {}
