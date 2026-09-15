import { All, Controller, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ProxyService } from '../proxy/proxy.service';

/** Always protected. order-service's routes already match this mount segment, so strip only /api. */
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly proxy: ProxyService,
    private readonly config: ConfigService,
  ) {}

  @All(['/', '*'])
  proxyToOrders(@Req() req: Request, @Res() res: Response): void {
    this.proxy.forward(req, res, {
      target: this.config.get<string>('ORDER_SERVICE_URL', 'http://localhost:3004'),
      stripPrefix: '^/api',
    });
  }
}
