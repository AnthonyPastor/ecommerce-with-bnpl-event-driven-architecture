import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  // No controller here reads `@Body()` — every route is a pure proxy to a
  // downstream service (see ProxyService). Nest's default body parser would
  // otherwise buffer + JSON.parse every proxied request body for nothing,
  // only for ProxyService to re-serialize it right back with fixRequestBody.
  // Disabling it lets http-proxy-middleware stream the raw request bytes
  // straight through, as it does natively.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  app.useLogger(app.get(Logger));
  app.enableCors();
  app.setGlobalPrefix('api');

  const config = app.get(ConfigService);
  await app.listen(config.get('PORT', 3000));
}
bootstrap();
