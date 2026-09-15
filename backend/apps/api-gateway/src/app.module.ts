import { CorrelationIdMiddleware, ObservabilityLoggerModule } from '@bnpl/observability';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { GatewayAuthGuard } from './common/gateway-auth.guard';
import { HealthModule } from './health/health.module';
import { CatalogModule } from './catalog/catalog.module';
import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { InstallmentPlansModule } from './installment-plans/installment-plans.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ObservabilityLoggerModule,
    HealthModule,
    CatalogModule,
    AuthModule,
    CartModule,
    OrdersModule,
    PaymentsModule,
    InstallmentPlansModule,
    NotificationsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: GatewayAuthGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
