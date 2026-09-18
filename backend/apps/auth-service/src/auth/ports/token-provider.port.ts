export interface AccessTokenPayload {
  sub: string;
  email: string;
}

export interface IssuedAccessToken {
  token: string;
  expiresIn: number;
}

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

export interface RotatedRefreshToken {
  payload: { sub: string };
  refreshToken: IssuedRefreshToken;
}

/**
 * Abstract port for the token provider — purely cryptographic/stateless
 * (it never touches the database). Refresh token persistence (so they can
 * be revoked/reuse detected) lives in AuthService, not here, so that any
 * future implementation (Auth0, Keycloak, Cognito) can be swapped in without
 * touching auth-service's business logic.
 */
export abstract class TokenProviderPort {
  abstract issueAccessToken(payload: AccessTokenPayload): IssuedAccessToken;
  abstract issueRefreshToken(payload: { sub: string }): IssuedRefreshToken;
  abstract verifyAccessToken(token: string): AccessTokenPayload;
  abstract rotateRefreshToken(oldToken: string): RotatedRefreshToken;
}

export const AUTH_TOKEN_PROVIDER = Symbol('AUTH_TOKEN_PROVIDER');
