import { All, Controller, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ProxyService } from '../proxy/proxy.service';

/** Always protected — operates on the authenticated user's own data. cart-service's routes already match this mount segment, so strip only /api. */
@Controller('cart')
export class CartController {
  constructor(
    private readonly proxy: ProxyService,
    private readonly config: ConfigService,
  ) {}

  @All(['/', '*'])
  proxyToCart(@Req() req: Request, @Res() res: Response): void {
    this.proxy.forward(req, res, {
      target: this.config.get<string>('CART_SERVICE_URL', 'http://localhost:3003'),
      stripPrefix: '^/api',
    });
  }
}
