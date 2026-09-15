import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { RequestContextModule } from './request-context.module';
import { RequestContextService } from './request-context.service';

/**
 * Structured logger (pino) that automatically injects correlationId/transactionId
 * into every line, reading them from the active context of RequestContextService
 * (the SAME instance that CorrelationIdMiddleware opens) — no need to pass them
 * by hand on every logger.log(...).
 */
@Module({
  imports: [
    RequestContextModule,
    PinoLoggerModule.forRootAsync({
      imports: [RequestContextModule],
      inject: [RequestContextService],
      useFactory: (requestContext: RequestContextService) => ({
        pinoHttp: {
          level: process.env.LOG_LEVEL ?? 'info',
          mixin: () => {
            const ctx = requestContext.get();
            return ctx
              ? { correlationId: ctx.correlationId, transactionId: ctx.transactionId }
              : {};
          },
          autoLogging: true,
        },
      }),
    }),
  ],
  exports: [PinoLoggerModule],
})
export class ObservabilityLoggerModule {}
