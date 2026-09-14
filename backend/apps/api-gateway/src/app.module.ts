import { CorrelationIdMiddleware, ObservabilityLoggerModule, RequestContextModule } from '@bnpl/observability';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), RequestContextModule, ObservabilityLoggerModule],
  providers: [CorrelationIdMiddleware],
  exports: [CorrelationIdMiddleware],
})
export class AppModule {}
