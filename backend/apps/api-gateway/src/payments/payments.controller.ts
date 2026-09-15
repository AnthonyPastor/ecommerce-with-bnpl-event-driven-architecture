import { All, Controller, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ProxyService } from '../proxy/proxy.service';

/** Always protected. payment-service's routes already match this mount segment, so strip only /api. Webhooks bypass this gateway entirely. */
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly proxy: ProxyService,
    private readonly config: ConfigService,
  ) {}

  @All(['/', '*'])
  proxyToPayments(@Req() req: Request, @Res() res: Response): void {
    this.proxy.forward(req, res, {
      target: this.config.get<string>('PAYMENT_SERVICE_URL', 'http://localhost:3005'),
      stripPrefix: '^/api',
    });
  }
}
