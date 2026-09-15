import { All, Controller, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ProxyService } from '../proxy/proxy.service';

/** Always protected. notification-service's routes already match this mount segment, so strip only /api. */
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly proxy: ProxyService,
    private readonly config: ConfigService,
  ) {}

  @All(['/', '*'])
  proxyToNotifications(@Req() req: Request, @Res() res: Response): void {
    this.proxy.forward(req, res, {
      target: this.config.get<string>('NOTIFICATION_SERVICE_URL', 'http://localhost:3007'),
      stripPrefix: '^/api',
    });
  }
}
