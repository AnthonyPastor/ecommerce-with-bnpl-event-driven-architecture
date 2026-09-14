import { RequestContextService } from './request-context.service';

describe('RequestContextService', () => {
  it('returns undefined outside of run()', () => {
    const svc = new RequestContextService();
    expect(svc.get()).toBeUndefined();
    expect(svc.getCorrelationId()).toBeUndefined();
  });

  it('exposes the context to synchronous code inside run()', () => {
    const svc = new RequestContextService();
    svc.run({ correlationId: 'corr-1' }, () => {
      expect(svc.getCorrelationId()).toBe('corr-1');
    });
  });

  it('propagates the context across an async call chain (await, setTimeout, Promise)', async () => {
    const svc = new RequestContextService();

    async function deeplyNestedAsyncWork(): Promise<string | undefined> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await Promise.resolve();
      return svc.getCorrelationId();
    }

    const result = await svc.run({ correlationId: 'corr-2', transactionId: 'txn-2' }, () =>
      deeplyNestedAsyncWork(),
    );

    expect(result).toBe('corr-2');
  });

  it('keeps concurrent contexts isolated from each other', async () => {
    const svc = new RequestContextService();

    async function work(correlationId: string): Promise<string | undefined> {
      return svc.run({ correlationId }, async () => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
        return svc.getCorrelationId();
      });
    }

    const [a, b, c] = await Promise.all([work('A'), work('B'), work('C')]);
    expect([a, b, c]).toEqual(['A', 'B', 'C']);
  });

  it('setTransactionId mutates the currently active context', () => {
    const svc = new RequestContextService();
    svc.run({ correlationId: 'corr-3' }, () => {
      expect(svc.getTransactionId()).toBeUndefined();
      svc.setTransactionId('txn-late');
      expect(svc.getTransactionId()).toBe('txn-late');
    });
  });
});
