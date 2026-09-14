import type { NextFunction, Request, Response } from 'express';
import { verify } from 'jsonwebtoken';

/**
 * Verificación de JWT en el borde (api-gateway) — punto único de auth para
 * todos los servicios detrás. Rutas públicas (register/login/refresh, y todo
 * /catalog) pasan directo; el resto exige un access token válido y propaga
 * el userId al servicio destino vía header `x-user-id`.
 */
export function createGatewayAuthMiddleware(jwtAccessSecret: string, publicPaths: Set<string>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.method} ${req.path}`;
    if (publicPaths.has(key)) {
      next();
      return;
    }

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ message: 'Missing bearer token' });
      return;
    }

    try {
      const payload = verify(header.slice('Bearer '.length), jwtAccessSecret) as { sub: string };
      req.headers['x-user-id'] = payload.sub;
      next();
    } catch {
      res.status(401).json({ message: 'Invalid or expired access token' });
    }
  };
}

export const AUTH_PUBLIC_PATHS = new Set(['POST /register', 'POST /login', 'POST /refresh']);

/** Ningún path público — todo bajo ese mount exige JWT válido. */
export const NO_PUBLIC_PATHS = new Set<string>();
