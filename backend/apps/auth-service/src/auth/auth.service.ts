import { createHash } from 'node:crypto';
import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from './entities/user.entity';
import { AUTH_TOKEN_PROVIDER, TokenProviderPort } from './ports/token-provider.port';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(RefreshToken) private readonly refreshTokens: Repository<RefreshToken>,
    @Inject(AUTH_TOKEN_PROVIDER) private readonly tokenProvider: TokenProviderPort,
  ) {}

  async register(input: { email: string; password: string; name: string }): Promise<User> {
    const existing = await this.users.findOne({ where: { email: input.email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }
    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = this.users.create({ email: input.email, passwordHash, name: input.name });
    return this.users.save(user);
    // TODO(phase 2+): publish auth.user.registered.v1 via outbox once
    // packages/outbox and packages/kafka-client exist.
  }

  async login(input: { email: string; password: string }): Promise<AuthTokens> {
    const user = await this.users.findOne({ where: { email: input.email } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.issueTokenPair(user.id, user.email);
  }

  async refresh(oldRefreshToken: string): Promise<AuthTokens> {
    const tokenHash = hashToken(oldRefreshToken);
    const stored = await this.refreshTokens.findOne({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const rotated = this.tokenProvider.rotateRefreshToken(oldRefreshToken);
    const user = await this.users.findOneOrFail({ where: { id: rotated.payload.sub } });

    stored.revokedAt = new Date();
    await this.refreshTokens.save(stored);

    const accessToken = this.tokenProvider.issueAccessToken({ sub: user.id, email: user.email });
    await this.persistRefreshToken(user.id, rotated.refreshToken);

    return {
      accessToken: accessToken.token,
      refreshToken: rotated.refreshToken.token,
      expiresIn: accessToken.expiresIn,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    const stored = await this.refreshTokens.findOne({ where: { tokenHash } });
    if (stored && !stored.revokedAt) {
      stored.revokedAt = new Date();
      await this.refreshTokens.save(stored);
    }
  }

  async me(userId: string): Promise<User> {
    return this.users.findOneOrFail({ where: { id: userId } });
  }

  private async issueTokenPair(userId: string, email: string): Promise<AuthTokens> {
    const accessToken = this.tokenProvider.issueAccessToken({ sub: userId, email });
    const refreshToken = this.tokenProvider.issueRefreshToken({ sub: userId });
    await this.persistRefreshToken(userId, refreshToken);
    return {
      accessToken: accessToken.token,
      refreshToken: refreshToken.token,
      expiresIn: accessToken.expiresIn,
    };
  }

  private async persistRefreshToken(
    userId: string,
    refreshToken: { token: string; expiresAt: Date },
  ): Promise<void> {
    const row = this.refreshTokens.create({
      userId,
      tokenHash: hashToken(refreshToken.token),
      expiresAt: refreshToken.expiresAt,
      revokedAt: null,
    });
    await this.refreshTokens.save(row);
  }
}
