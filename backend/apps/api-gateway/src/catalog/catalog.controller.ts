import { All, Controller, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Public } from '../common/public.decorator';
import { ProxyService } from '../proxy/proxy.service';

/** Public browsing (ecommerce catalog) — catalog-service exposes bare routes (e.g. /products), so strip /api/catalog entirely. */
@Controller('catalog')
@Public()
export class CatalogController {
  constructor(
    private readonly proxy: ProxyService,
    private readonly config: ConfigService,
  ) {}

  @All(['/', '*'])
  proxyToCatalog(@Req() req: Request, @Res() res: Response): void {
    this.proxy.forward(req, res, {
      target: this.config.get<string>('CATALOG_SERVICE_URL', 'http://localhost:3002'),
      stripPrefix: '^/api/catalog',
    });
  }
}
