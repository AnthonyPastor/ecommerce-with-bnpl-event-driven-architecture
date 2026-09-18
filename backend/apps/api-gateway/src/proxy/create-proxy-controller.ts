import { All, Controller, Req, Res, Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ProxyService } from './proxy.service';

/**
 * Builds a `@Controller()` that forwards every method/path under `routePrefix`
 * to `target` (resolved from `envVar`, falling back to `defaultTarget`),
 * stripping only `/api`. Covers every mount that needs nothing beyond a
 * straight passthrough (`cart`, `orders`, `payments`, `installment-plans`,
 * `notifications`) — `catalog` and `auth` have per-route `@Public()`/custom
 * `stripPrefix` rules and stay hand-written.
 */
export function createProxyController(routePrefix: string, envVar: string, defaultTarget: string): Type<unknown> {
  @Controller(routePrefix)
  class ProxyController {
    constructor(
      private readonly proxy: ProxyService,
      private readonly config: ConfigService,
    ) {}

    @All(['/', '*'])
    forward(@Req() req: Request, @Res() res: Response): void {
      this.proxy.forward(req, res, {
        target: this.config.get<string>(envVar, defaultTarget),
        stripPrefix: '^/api',
      });
    }
  }

  Object.defineProperty(ProxyController, 'name', { value: `${routePrefix}ProxyController` });
  return ProxyController;
}
