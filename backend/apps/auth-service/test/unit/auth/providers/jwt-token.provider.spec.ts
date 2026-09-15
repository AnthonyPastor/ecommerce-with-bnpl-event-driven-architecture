import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { JwtTokenProvider } from '../../../../src/auth/providers/jwt-token.provider';

function makeProvider(): JwtTokenProvider {
  const config = new ConfigService({
    JWT_ACCESS_SECRET: 'test-access-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
    JWT_ACCESS_TTL_SECONDS: 900,
    JWT_REFRESH_TTL_DAYS: 30,
  });
  return new JwtTokenProvider(new JwtService(), config);
}

// These tests run against the TokenProviderPort contract — any future
// implementation (MercadoPago-like for other ports, or Auth0/Keycloak for
// this one) should be able to pass the same battery of cases.
describe('JwtTokenProvider (TokenProviderPort contract)', () => {
  it('issues an access token that verifyAccessToken can decode back to the same payload', () => {
    const provider = makeProvider();
    const issued = provider.issueAccessToken({ sub: 'user-1', email: 'a@b.com' });

    expect(issued.token).toEqual(expect.any(String));
    expect(issued.expiresIn).toBe(900);

    const payload = provider.verifyAccessToken(issued.token);
    expect(payload.sub).toBe('user-1');
    expect(payload.email).toBe('a@b.com');
  });

  it('rejects a tampered/invalid access token', () => {
    const provider = makeProvider();
    expect(() => provider.verifyAccessToken('not-a-real-token')).toThrow(UnauthorizedException);
  });

  it('issues a refresh token with a future expiry', () => {
    const provider = makeProvider();
    const issued = provider.issueRefreshToken({ sub: 'user-1' });
    expect(issued.token).toEqual(expect.any(String));
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('rotateRefreshToken verifies the old token and issues a brand new one', () => {
    const provider = makeProvider();
    const original = provider.issueRefreshToken({ sub: 'user-1' });

    const rotated = provider.rotateRefreshToken(original.token);

    expect(rotated.payload.sub).toBe('user-1');
    expect(rotated.refreshToken.token).not.toBe(original.token);
  });

  it('rotateRefreshToken rejects an invalid old token', () => {
    const provider = makeProvider();
    expect(() => provider.rotateRefreshToken('garbage')).toThrow(UnauthorizedException);
  });

  it('access and refresh tokens are signed with different secrets (cannot cross-verify)', () => {
    const provider = makeProvider();
    const access = provider.issueAccessToken({ sub: 'user-1', email: 'a@b.com' });
    expect(() => provider.rotateRefreshToken(access.token)).toThrow(UnauthorizedException);
  });
});
