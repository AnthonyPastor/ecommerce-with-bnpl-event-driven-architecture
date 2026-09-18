import { HttpModule, HttpService } from '@nestjs/axios';
import { Injectable, Module } from '@nestjs/common';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { Observable } from 'rxjs';
import { CORRELATION_ID_HEADER, TRANSACTION_ID_HEADER } from './correlation-id.middleware';
import { RequestContextModule } from './request-context.module';
import { RequestContextService } from './request-context.service';

/**
 * HttpService wrapper that, on every outgoing call between services, takes
 * correlationId/transactionId from the active context and sets them as
 * outbound headers — so an inbound webhook on a brand-new request recovers
 * the same transactionId as the rest of the flow, and the correlationId is
 * propagated without every caller having to remember to pass it.
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
