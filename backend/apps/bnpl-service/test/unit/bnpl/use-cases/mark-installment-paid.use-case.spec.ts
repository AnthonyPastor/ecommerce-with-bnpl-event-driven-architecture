import { InstallmentStatus } from '@bnpl/event-contracts';
import { MarkInstallmentPaidUseCase } from '../../../../src/bnpl/use-cases/mark-installment-paid.use-case';
import { PaymentEventPayload } from '../../../../src/bnpl/use-cases/payment-event-payload';
import { makeFakeQueryRunner } from './query-runner.mock';

function makeUseCase(fake: ReturnType<typeof makeFakeQueryRunner>) {
  const dataSource = { createQueryRunner: jest.fn(() => fake.queryRunner) };
  const requestContext = { getCorrelationId: jest.fn(() => 'corr-1') };
  return { useCase: new MarkInstallmentPaidUseCase(dataSource as any, requestContext as any) };
}

const payload: PaymentEventPayload = {
  transactionId: 'txn-1',
  orderId: 'order-1',
  userId: 'user-1',
  amountCents: 3333,
  currency: 'USD',
  installmentId: 'installment-1',
};

describe('MarkInstallmentPaidUseCase', () => {
  it('marks a PENDING/DUE installment PAID and publishes bnpl.installment.paid.v1', async () => {
    const fake = makeFakeQueryRunner();
    fake.setFound({ id: 'installment-1', status: InstallmentStatus.DUE, amountCents: 3333 });
    const { useCase } = makeUseCase(fake);

    await useCase.execute(payload);

    expect(fake.saved.some((e: any) => e.status === InstallmentStatus.PAID)).toBe(true);
    expect(fake.queryRunner.commitTransaction).toHaveBeenCalled();
  });

  it('is idempotent when the installment is already PAID', async () => {
    const fake = makeFakeQueryRunner();
    fake.setFound({ id: 'installment-1', status: InstallmentStatus.PAID, amountCents: 3333 });
    const { useCase } = makeUseCase(fake);

    await useCase.execute(payload);

    expect(fake.queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(fake.saved).toHaveLength(0);
  });

  it('is a no-op when no installment exists for that id', async () => {
    const fake = makeFakeQueryRunner();
    const { useCase } = makeUseCase(fake);

    await useCase.execute(payload);

    expect(fake.queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(fake.saved).toHaveLength(0);
  });

  it('is a no-op when the payload has no installmentId', async () => {
    const fake = makeFakeQueryRunner();
    const { useCase } = makeUseCase(fake);

    await useCase.execute({ ...payload, installmentId: undefined });

    expect(fake.queryRunner.connect).not.toHaveBeenCalled();
  });
});
