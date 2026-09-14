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
 * Puerto abstracto del proveedor de tokens — puramente criptográfico/sin estado
 * (no toca la base de datos). La persistencia de refresh tokens (para poder
 * revocarlos/detectar reuso) vive en AuthService, no acá, para que cualquier
 * implementación futura (Auth0, Keycloak, Cognito) pueda swappearse sin tocar
 * la lógica de negocio de auth-service.
 */
export abstract class TokenProviderPort {
  abstract issueAccessToken(payload: AccessTokenPayload): IssuedAccessToken;
  abstract issueRefreshToken(payload: { sub: string }): IssuedRefreshToken;
  abstract verifyAccessToken(token: string): AccessTokenPayload;
  abstract rotateRefreshToken(oldToken: string): RotatedRefreshToken;
}

export const AUTH_TOKEN_PROVIDER = Symbol('AUTH_TOKEN_PROVIDER');
