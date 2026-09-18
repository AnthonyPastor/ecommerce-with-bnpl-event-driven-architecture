import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { AuthService } from '../../../src/auth/auth.service';
import { RefreshToken } from '../../../src/auth/entities/refresh-token.entity';
import { User } from '../../../src/auth/entities/user.entity';
import { AUTH_TOKEN_PROVIDER, TokenProviderPort } from '../../../src/auth/ports/token-provider.port';

describe('AuthService', () => {
  let service: AuthService;
  let users: jest.Mocked<Repository<User>>;
  let refreshTokens: jest.Mocked<Repository<RefreshToken>>;
  let tokenProvider: jest.Mocked<TokenProviderPort>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
            findOneOrFail: jest.fn(),
            create: jest.fn((data) => data),
            save: jest.fn((data) => ({ id: 'generated-id', ...data })),
          },
        },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn((data) => data),
            save: jest.fn((data) => data),
          },
        },
        {
          provide: AUTH_TOKEN_PROVIDER,
          useValue: {
            issueAccessToken: jest.fn(() => ({ token: 'access-token', expiresIn: 900 })),
            issueRefreshToken: jest.fn(() => ({
              token: 'refresh-token',
              expiresAt: new Date(Date.now() + 1000 * 60 * 60),
            })),
            verifyAccessToken: jest.fn(),
            rotateRefreshToken: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
    users = module.get(getRepositoryToken(User));
    refreshTokens = module.get(getRepositoryToken(RefreshToken));
    tokenProvider = module.get(AUTH_TOKEN_PROVIDER);
  });

  describe('register', () => {
    it('hashes the password and creates the user', async () => {
      users.findOne.mockResolvedValue(null);

      const user = await service.register({
        email: 'new@user.com',
        password: 'plaintext-pw',
        name: 'New User',
      });

      expect(user.email).toBe('new@user.com');
      expect(user.passwordHash).not.toBe('plaintext-pw');
      expect(await bcrypt.compare('plaintext-pw', user.passwordHash)).toBe(true);
    });

    it('rejects a duplicate email', async () => {
      users.findOne.mockResolvedValue({ id: 'existing' } as User);

      await expect(
        service.register({ email: 'dup@user.com', password: 'x', name: 'X' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('rejects unknown email', async () => {
      users.findOne.mockResolvedValue(null);
      await expect(service.login({ email: 'nope@x.com', password: 'x' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects wrong password', async () => {
      const passwordHash = await bcrypt.hash('correct-pw', 10);
      users.findOne.mockResolvedValue({ id: 'u1', email: 'a@b.com', passwordHash } as User);

      await expect(service.login({ email: 'a@b.com', password: 'wrong' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('issues a token pair and persists the refresh token hash on success', async () => {
      const passwordHash = await bcrypt.hash('correct-pw', 10);
      users.findOne.mockResolvedValue({ id: 'u1', email: 'a@b.com', passwordHash } as User);

      const result = await service.login({ email: 'a@b.com', password: 'correct-pw' });

      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresIn: 900,
      });
      expect(refreshTokens.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', revokedAt: null }),
      );
    });
  });

  describe('refresh', () => {
    it('rejects when the stored refresh token is missing, revoked or expired', async () => {
      refreshTokens.findOne.mockResolvedValue(null);
      await expect(service.refresh('unknown-token')).rejects.toThrow(UnauthorizedException);

      refreshTokens.findOne.mockResolvedValue({
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 10000),
      } as RefreshToken);
      await expect(service.refresh('revoked-token')).rejects.toThrow(UnauthorizedException);

      refreshTokens.findOne.mockResolvedValue({
        revokedAt: null,
        expiresAt: new Date(Date.now() - 10000),
      } as RefreshToken);
      await expect(service.refresh('expired-token')).rejects.toThrow(UnauthorizedException);
    });

    it('rotates the refresh token and revokes the old one', async () => {
      refreshTokens.findOne.mockResolvedValue({
        id: 'row-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 10000),
      } as RefreshToken);
      tokenProvider.rotateRefreshToken.mockReturnValue({
        payload: { sub: 'u1' },
        refreshToken: { token: 'new-refresh', expiresAt: new Date(Date.now() + 100000) },
      });
      users.findOneOrFail.mockResolvedValue({ id: 'u1', email: 'a@b.com' } as User);

      const result = await service.refresh('old-refresh-token');

      expect(result.refreshToken).toBe('new-refresh');
      expect(refreshTokens.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'row-1', revokedAt: expect.any(Date) }),
      );
    });
  });

  describe('logout', () => {
    it('marks the matching refresh token row as revoked', async () => {
      const row = { revokedAt: null } as RefreshToken;
      refreshTokens.findOne.mockResolvedValue(row);

      await service.logout('some-token');

      expect(refreshTokens.save).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });

    it('is a no-op when the token is not found', async () => {
      refreshTokens.findOne.mockResolvedValue(null);
      await service.logout('unknown');
      expect(refreshTokens.save).not.toHaveBeenCalled();
    });
  });
});
