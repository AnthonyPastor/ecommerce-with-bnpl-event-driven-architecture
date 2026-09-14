import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CorrelationIdMiddleware, ObservabilityLoggerModule } from '@bnpl/observability';
import { CatalogModule } from './catalog/catalog.module';
import { HealthModule } from './health/health.module';
import { Category } from './catalog/entities/category.entity';
import { Product } from './catalog/entities/product.entity';
import { ProductVariant } from './catalog/entities/product-variant.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ObservabilityLoggerModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('POSTGRES_HOST', 'localhost'),
        port: config.get<number>('POSTGRES_PORT', 5432),
        username: config.get<string>('POSTGRES_USER', 'bnpl'),
        password: config.get<string>('POSTGRES_PASSWORD', 'bnpl'),
        database: config.get<string>('POSTGRES_DB', 'catalog_db'),
        entities: [Product, Category, ProductVariant],
        synchronize: true,
      }),
    }),
    CatalogModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
