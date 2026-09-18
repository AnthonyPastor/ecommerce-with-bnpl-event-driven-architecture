import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { sign } from 'jsonwebtoken';
import { GatewayAuthGuard } from '../../../src/common/gateway-auth.guard';

const SECRET = 'test-secret';

function makeContext(headers: Record<string, string> = {}, isPublic = false) {
  const req: any = { headers };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;

  const reflector = { getAllAndOverride: jest.fn(() => isPublic) } as unknown as Reflector;
  return { context, req, reflector };
}

function makeGuard(reflector: Reflector) {
  const config = new ConfigService({ JWT_ACCESS_SECRET: SECRET });
  return new GatewayAuthGuard(reflector, config);
}

describe('GatewayAuthGuard', () => {
  it('lets a @Public() route through without a token', () => {
    const { context, reflector } = makeContext({}, true);
    const guard = makeGuard(reflector);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a protected route with no Authorization header', () => {
    const { context, reflector } = makeContext({}, false);
    const guard = makeGuard(reflector);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context)).toThrow('Missing bearer token');
  });

  it('rejects a protected route with an invalid token', () => {
    const { context, reflector } = makeContext({ authorization: 'Bearer not-a-real-token' }, false);
    const guard = makeGuard(reflector);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context)).toThrow('Invalid or expired access token');
  });

  it('forwards a valid token and injects x-user-id', () => {
    const token = sign({ sub: 'user-123', email: 'a@b.com' }, SECRET, { expiresIn: '15m' });
    const { context, req, reflector } = makeContext({ authorization: `Bearer ${token}` }, false);
    const guard = makeGuard(reflector);

    expect(guard.canActivate(context)).toBe(true);
    expect(req.headers['x-user-id']).toBe('user-123');
  });

  it('rejects a token signed with a different secret', () => {
    const token = sign({ sub: 'user-123' }, 'wrong-secret', { expiresIn: '15m' });
    const { context, reflector } = makeContext({ authorization: `Bearer ${token}` }, false);
    const guard = makeGuard(reflector);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
