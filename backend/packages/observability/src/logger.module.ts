import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { RequestContextModule } from './request-context.module';
import { RequestContextService } from './request-context.service';

/**
 * Logger estructurado (pino) que inyecta correlationId/transactionId en cada
 * línea automáticamente, leyéndolos del contexto activo de RequestContextService
 * (la MISMA instancia que abre CorrelationIdMiddleware) — no hace falta pasarlos
 * a mano en cada logger.log(...).
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
