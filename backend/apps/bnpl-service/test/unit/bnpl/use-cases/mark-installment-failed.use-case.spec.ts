import { InstallmentStatus } from '@bnpl/event-contracts';
import { MarkInstallmentFailedUseCase } from '../../../../src/bnpl/use-cases/mark-installment-failed.use-case';
import { PaymentEventPayload } from '../../../../src/bnpl/use-cases/payment-event-payload';
import { makeFakeQueryRunner } from './query-runner.mock';

function makeUseCase(fake: ReturnType<typeof makeFakeQueryRunner>) {
  const dataSource = { createQueryRunner: jest.fn(() => fake.queryRunner) };
  const creditScoring = { markBlocked: jest.fn(async () => undefined) };
  const requestContext = { getCorrelationId: jest.fn(() => 'corr-1') };
  return { useCase: new MarkInstallmentFailedUseCase(dataSource as any, creditScoring as any, requestContext as any), creditScoring };
}

const payload: PaymentEventPayload = {
  transactionId: 'txn-1',
  orderId: 'order-1',
  userId: 'user-1',
  amountCents: 3333,
  currency: 'USD',
  installmentId: 'installment-1',
};

describe('MarkInstallmentFailedUseCase', () => {
  it('reschedules a PENDING installment for retry when under the retry limit', async () => {
    const fake = makeFakeQueryRunner();
    fake.setFound({
      id: 'installment-1',
      status: InstallmentStatus.DUE,
      amountCents: 3333,
      retryCount: 0,
      dueDate: new Date('2026-01-01'),
    });
    const { useCase, creditScoring } = makeUseCase(fake);

    await useCase.execute(payload);

    const updated = fake.saved.find((e: any) => e.id === 'installment-1') as any;
    expect(updated.status).toBe(InstallmentStatus.PENDING);
    expect(updated.retryCount).toBe(1);
    expect(updated.dueDate.getTime()).toBeGreaterThan(new Date('2026-01-01').getTime());
    expect(creditScoring.markBlocked).not.toHaveBeenCalled();
  });

  it('DEFAULTs the installment and blocks the credit profile once retries are exhausted', async () => {
    const fake = makeFakeQueryRunner();
    fake.setFound({ id: 'installment-1', status: InstallmentStatus.DUE, amountCents: 3333, retryCount: 2 });
    const { useCase, creditScoring } = makeUseCase(fake);

    await useCase.execute(payload);

    expect(fake.saved.some((e: any) => e.status === InstallmentStatus.DEFAULTED && e.retryCount === 3)).toBe(true);
    expect(creditScoring.markBlocked).toHaveBeenCalledWith('user-1', fake.queryRunner.manager);
  });

  it('is idempotent when the installment is already resolved (e.g. DEFAULTED)', async () => {
    const fake = makeFakeQueryRunner();
    fake.setFound({ id: 'installment-1', status: InstallmentStatus.DEFAULTED, amountCents: 3333, retryCount: 3 });
    const { useCase, creditScoring } = makeUseCase(fake);

    await useCase.execute(payload);

    expect(fake.queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(fake.saved).toHaveLength(0);
    expect(creditScoring.markBlocked).not.toHaveBeenCalled();
  });

  it('is a no-op when no installment exists for that id', async () => {
    const fake = makeFakeQueryRunner();
    const { useCase } = makeUseCase(fake);

    await useCase.execute(payload);

    expect(fake.queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(fake.saved).toHaveLength(0);
  });
});
