import { sign } from 'jsonwebtoken';
import { AUTH_PUBLIC_PATHS, createGatewayAuthMiddleware } from './gateway-auth.middleware';

const SECRET = 'test-secret';

function mockReqRes(method: string, path: string, authHeader?: string) {
  const req: any = { method, path, headers: authHeader ? { authorization: authHeader } : {} };
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const res: any = { status, json };
  const next = jest.fn();
  return { req, res, next, json, status };
}

describe('createGatewayAuthMiddleware', () => {
  const middleware = createGatewayAuthMiddleware(SECRET, AUTH_PUBLIC_PATHS);

  it('lets public paths through without a token', () => {
    const { req, res, next } = mockReqRes('POST', '/login');
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a protected path with no Authorization header', () => {
    const { req, res, next, status, json } = mockReqRes('GET', '/me');
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('rejects a protected path with an invalid token', () => {
    const { req, res, next, status } = mockReqRes('GET', '/me', 'Bearer not-a-real-token');
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('forwards a valid token and injects x-user-id', () => {
    const token = sign({ sub: 'user-123', email: 'a@b.com' }, SECRET, { expiresIn: '15m' });
    const { req, res, next } = mockReqRes('GET', '/me', `Bearer ${token}`);
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.headers['x-user-id']).toBe('user-123');
  });

  it('rejects a token signed with a different secret', () => {
    const token = sign({ sub: 'user-123' }, 'wrong-secret', { expiresIn: '15m' });
    const { req, res, next, status } = mockReqRes('POST', '/logout', `Bearer ${token}`);
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });
});
