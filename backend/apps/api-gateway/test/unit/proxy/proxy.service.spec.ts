import { ProxyService } from '../../../src/proxy/proxy.service';

const middlewareInstances: jest.Mock[] = [];

jest.mock('http-proxy-middleware', () => ({
  createProxyMiddleware: jest.fn(() => {
    const mw = jest.fn();
    middlewareInstances.push(mw);
    return mw;
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createProxyMiddleware } = require('http-proxy-middleware');

describe('ProxyService', () => {
  beforeEach(() => {
    middlewareInstances.length = 0;
    (createProxyMiddleware as jest.Mock).mockClear();
  });

  it('creates one proxy middleware per unique target+stripPrefix and reuses it on subsequent calls', () => {
    const service = new ProxyService();
    const req = {} as any;
    const res = {} as any;

    service.forward(req, res, { target: 'http://localhost:3001', stripPrefix: '^/api' });
    service.forward(req, res, { target: 'http://localhost:3001', stripPrefix: '^/api' });

    expect(createProxyMiddleware).toHaveBeenCalledTimes(1);
    expect(middlewareInstances[0]).toHaveBeenCalledTimes(2);
  });

  it('creates a separate middleware instance for a different target', () => {
    const service = new ProxyService();
    const req = {} as any;
    const res = {} as any;

    service.forward(req, res, { target: 'http://localhost:3001', stripPrefix: '^/api' });
    service.forward(req, res, { target: 'http://localhost:3002', stripPrefix: '^/api' });

    expect(createProxyMiddleware).toHaveBeenCalledTimes(2);
  });

  it('creates a separate middleware instance for the same target with a different stripPrefix', () => {
    const service = new ProxyService();
    const req = {} as any;
    const res = {} as any;

    service.forward(req, res, { target: 'http://localhost:3002', stripPrefix: '^/api' });
    service.forward(req, res, { target: 'http://localhost:3002', stripPrefix: '^/api/catalog' });

    expect(createProxyMiddleware).toHaveBeenCalledTimes(2);
  });

  it('passes target/changeOrigin/pathRewrite through to createProxyMiddleware', () => {
    const service = new ProxyService();
    service.forward({} as any, {} as any, { target: 'http://localhost:3002', stripPrefix: '^/api/catalog' });

    expect(createProxyMiddleware).toHaveBeenCalledWith(
      expect.objectContaining({
        target: 'http://localhost:3002',
        changeOrigin: true,
        pathRewrite: { '^/api/catalog': '' },
      }),
    );
  });

  it('does not set onProxyReq — Nest\'s global body parser is disabled (see main.ts) so http-proxy-middleware streams the raw request body itself', () => {
    const service = new ProxyService();
    service.forward({} as any, {} as any, { target: 'http://localhost:3001', stripPrefix: '^/api' });

    expect(createProxyMiddleware).toHaveBeenCalledWith(expect.not.objectContaining({ onProxyReq: expect.anything() }));
  });
});
