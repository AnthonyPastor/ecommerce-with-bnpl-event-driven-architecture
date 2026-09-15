import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createProxyMiddleware, fixRequestBody, type RequestHandler } from 'http-proxy-middleware';

export interface ProxyForwardOptions {
  target: string;
  /** Regex pattern (as used by http-proxy-middleware's pathRewrite) to strip from the incoming path before forwarding. */
  stripPrefix: string;
}

/**
 * Wraps http-proxy-middleware behind an injectable service so proxying can be
 * triggered from a real controller handler (guards/decorators apply exactly
 * like any other Nest route) instead of mounting raw Express middleware.
 * One `createProxyMiddleware` instance is created and reused per unique
 * target+stripPrefix combination.
 */
@Injectable()
export class ProxyService {
  private readonly middlewares = new Map<string, RequestHandler>();

  forward(req: Request, res: Response, options: ProxyForwardOptions): void {
    const key = `${options.target}::${options.stripPrefix}`;
    let middleware = this.middlewares.get(key);
    if (!middleware) {
      middleware = createProxyMiddleware({
        target: options.target,
        changeOrigin: true,
        pathRewrite: { [options.stripPrefix]: '' },
        // Nest's global body-parser already drains the request stream before
        // this handler runs (unlike the old raw-Express setup, where the
        // proxy intercepted requests before Nest's own middleware pipeline
        // ever touched them) — re-serialize the already-parsed req.body onto
        // the proxied request, or POST/PUT/PATCH bodies never reach the
        // downstream service and the request hangs.
        onProxyReq: fixRequestBody,
      });
      this.middlewares.set(key, middleware);
    }
    middleware(req, res, () => undefined);
  }
}
