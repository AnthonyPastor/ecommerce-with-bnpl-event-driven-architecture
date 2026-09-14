import { CorrelationIdMiddleware } from '@bnpl/observability';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import {
  AUTH_PUBLIC_PATHS,
  NO_PUBLIC_PATHS,
  createGatewayAuthMiddleware,
} from './gateway/gateway-auth.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableCors();

  const config = app.get(ConfigService);
  const authServiceUrl = config.get<string>('AUTH_SERVICE_URL', 'http://localhost:3001');
  const catalogServiceUrl = config.get<string>('CATALOG_SERVICE_URL', 'http://localhost:3002');
  const cartServiceUrl = config.get<string>('CART_SERVICE_URL', 'http://localhost:3003');
  const orderServiceUrl = config.get<string>('ORDER_SERVICE_URL', 'http://localhost:3004');
  const paymentServiceUrl = config.get<string>('PAYMENT_SERVICE_URL', 'http://localhost:3005');
  const bnplServiceUrl = config.get<string>('BNPL_SERVICE_URL', 'http://localhost:3006');
  const notificationServiceUrl = config.get<string>('NOTIFICATION_SERVICE_URL', 'http://localhost:3007');
  const jwtAccessSecret = config.get<string>('JWT_ACCESS_SECRET', 'dev-access-secret');

  const expressApp = app.getHttpAdapter().getInstance();
  const correlationMiddleware = app.get(CorrelationIdMiddleware);
  expressApp.use((req: Request, res: Response, next: NextFunction) =>
    correlationMiddleware.use(req, res, next),
  );

  expressApp.get('/api/health', (_req: Request, res: Response) => res.json({ status: 'ok' }));

  // /api/catalog/** es público (browsing de un ecommerce) -> catalog-service no usa prefijo propio.
  expressApp.use(
    '/api/catalog',
    createProxyMiddleware({
      target: catalogServiceUrl,
      changeOrigin: true,
      pathRewrite: { '^/api/catalog': '' },
    }),
  );

  // /api/auth/** requiere JWT salvo register/login/refresh -> auth-service SÍ usa prefijo /auth propio.
  expressApp.use(
    '/api/auth',
    createGatewayAuthMiddleware(jwtAccessSecret, AUTH_PUBLIC_PATHS),
    createProxyMiddleware({
      target: authServiceUrl,
      changeOrigin: true,
      pathRewrite: { '^/api': '' },
    }),
  );

  // Cart/Orders/Payments/Installment-plans son siempre privados (operan sobre
  // datos del usuario autenticado) — ningún path público dentro de estos mounts.
  // Cada uno de estos servicios ya expone sus rutas con ese mismo segmento
  // (cart-service -> /cart/..., order-service -> /orders/..., etc), así que
  // el proxy solo necesita sacar el prefijo /api.
  const privateProxies: Array<[string, string]> = [
    ['/api/cart', cartServiceUrl],
    ['/api/orders', orderServiceUrl],
    ['/api/payments', paymentServiceUrl],
    ['/api/installment-plans', bnplServiceUrl],
    ['/api/notifications', notificationServiceUrl],
  ];
  for (const [mount, target] of privateProxies) {
    expressApp.use(
      mount,
      createGatewayAuthMiddleware(jwtAccessSecret, NO_PUBLIC_PATHS),
      createProxyMiddleware({ target, changeOrigin: true, pathRewrite: { '^/api': '' } }),
    );
  }

  await app.listen(config.get('PORT', 3000));
}
bootstrap();
