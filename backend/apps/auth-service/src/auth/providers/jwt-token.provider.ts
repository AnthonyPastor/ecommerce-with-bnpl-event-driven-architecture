import { randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  AccessTokenPayload,
  IssuedAccessToken,
  IssuedRefreshToken,
  RotatedRefreshToken,
  TokenProviderPort,
} from '../ports/token-provider.port';

interface RefreshTokenClaims {
  sub: string;
  jti: string;
}

/**
 * Default implementation of TokenProviderPort: our own JWTs (access + refresh
 * signed with separate secrets). Another implementation (Auth0/Keycloak) plugs
 * in behind the same port without touching AuthService.
 */
@Injectable()
export class JwtTokenProvider extends TokenProviderPort {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlDays: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    super();
    this.accessSecret = this.config.get<string>('JWT_ACCESS_SECRET', 'dev-access-secret');
    this.refreshSecret = this.config.get<string>('JWT_REFRESH_SECRET', 'dev-refresh-secret');
    this.accessTtlSeconds = Number(this.config.get('JWT_ACCESS_TTL_SECONDS', 900));
    this.refreshTtlDays = Number(this.config.get('JWT_REFRESH_TTL_DAYS', 30));
  }

  issueAccessToken(payload: AccessTokenPayload): IssuedAccessToken {
    const token = this.jwt.sign(payload, {
      secret: this.accessSecret,
      expiresIn: this.accessTtlSeconds,
    });
    return { token, expiresIn: this.accessTtlSeconds };
  }

  issueRefreshToken(payload: { sub: string }): IssuedRefreshToken {
    const jti = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000);
    const token = this.jwt.sign(
      { sub: payload.sub, jti } satisfies RefreshTokenClaims,
      {
        secret: this.refreshSecret,
        expiresIn: `${this.refreshTtlDays}d`,
      },
    );
    return { token, expiresAt };
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      return this.jwt.verify<AccessTokenPayload>(token, { secret: this.accessSecret });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  rotateRefreshToken(oldToken: string): RotatedRefreshToken {
    let claims: RefreshTokenClaims;
    try {
      claims = this.jwt.verify<RefreshTokenClaims>(oldToken, { secret: this.refreshSecret });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const refreshToken = this.issueRefreshToken({ sub: claims.sub });
    return { payload: { sub: claims.sub }, refreshToken };
  }
}
