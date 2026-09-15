import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { verify } from 'jsonwebtoken';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * JWT verification at the edge (api-gateway) — the single auth checkpoint for
 * every service behind it. Registered globally (see AppModule's APP_GUARD),
 * so every route requires a valid bearer token unless marked @Public().
 * Injects `x-user-id` into the proxied request so downstream services could
 * trust that header instead of re-verifying (none currently do).
 */
@Injectable()
export class GatewayAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const jwtAccessSecret = this.config.get<string>('JWT_ACCESS_SECRET', 'dev-access-secret');
      const payload = verify(header.slice('Bearer '.length), jwtAccessSecret) as { sub: string };
      req.headers['x-user-id'] = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
