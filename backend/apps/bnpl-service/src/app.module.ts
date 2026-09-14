import { KafkaModule } from '@bnpl/kafka-client';
import { CorrelationIdMiddleware, ObservabilityLoggerModule } from '@bnpl/observability';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BnplModule } from './bnpl/bnpl.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ObservabilityLoggerModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('POSTGRES_HOST', 'localhost'),
        port: Number(config.get('POSTGRES_PORT', 5432)),
        username: config.get('POSTGRES_USER', 'bnpl'),
        password: config.get('POSTGRES_PASSWORD', 'bnpl'),
        database: config.get('POSTGRES_DB', 'bnpl_db'),
        autoLoadEntities: true,
        synchronize: true,
      }),
    }),
    KafkaModule.forRoot({
      clientId: 'bnpl-service',
      groupId: 'bnpl-service',
      brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    }),
    BnplModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
