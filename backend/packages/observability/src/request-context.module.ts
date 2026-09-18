import { Global, Module } from '@nestjs/common';
import { RequestContextService } from './request-context.service';

/**
 * Global so that a single instance of RequestContextService exists (and
 * therefore a single AsyncLocalStorage) shared between the middleware that
 * opens the context and everything that reads it afterwards (logger, HTTP
 * client, consumers).
 */
@Global()
@Module({
  providers: [RequestContextService],
  exports: [RequestContextService],
})
export class RequestContextModule {}
