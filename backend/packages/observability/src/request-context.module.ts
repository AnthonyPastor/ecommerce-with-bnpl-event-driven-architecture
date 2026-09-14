import { Global, Module } from '@nestjs/common';
import { RequestContextService } from './request-context.service';

/**
 * Global para que exista una única instancia de RequestContextService (y por
 * lo tanto una única AsyncLocalStorage) compartida entre el middleware que
 * abre el contexto y todo lo que lo lee después (logger, HTTP client, consumers).
 */
@Global()
@Module({
  providers: [RequestContextService],
  exports: [RequestContextService],
})
export class RequestContextModule {}
