import { All, Controller, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ProxyService } from '../proxy/proxy.service';

/** Always protected. bnpl-service's routes already match this mount segment, so strip only /api. */
@Controller('installment-plans')
export class InstallmentPlansController {
  constructor(
    private readonly proxy: ProxyService,
    private readonly config: ConfigService,
  ) {}

  @All(['/', '*'])
  proxyToBnpl(@Req() req: Request, @Res() res: Response): void {
    this.proxy.forward(req, res, {
      target: this.config.get<string>('BNPL_SERVICE_URL', 'http://localhost:3006'),
      stripPrefix: '^/api',
    });
  }
}
