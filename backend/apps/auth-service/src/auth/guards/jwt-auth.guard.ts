import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH_TOKEN_PROVIDER, TokenProviderPort } from '@auth/auth/ports/token-provider.port';

export interface AuthenticatedRequest extends Request {
  user: { sub: string; email: string };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(AUTH_TOKEN_PROVIDER) private readonly tokenProvider: TokenProviderPort) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length);
    req.user = this.tokenProvider.verifyAccessToken(token);
    return true;
  }
}
