import { InstallmentStatus, PaymentMethod } from '@bnpl/event-contracts';
import { ActivateInstallmentPlanUseCase } from '../../../../src/bnpl/use-cases/activate-installment-plan.use-case';
import { PaymentEventPayload } from '../../../../src/bnpl/use-cases/payment-event-payload';
import { makeFakeQueryRunner } from './query-runner.mock';

function makeUseCase(opts?: { blocked?: boolean; queryRunner?: ReturnType<typeof makeFakeQueryRunner> }) {
  const fake = opts?.queryRunner ?? makeFakeQueryRunner();
  const dataSource = { createQueryRunner: jest.fn(() => fake.queryRunner) };
  const creditScoring = {
    getOrCreateProfile: jest.fn(async () => ({ userId: 'user-1', blocked: opts?.blocked ?? false })),
    scoreUser: jest.fn(async () => ({ approved: true })),
  };
  const requestContext = { getCorrelationId: jest.fn(() => 'corr-1') };

  const useCase = new ActivateInstallmentPlanUseCase(dataSource as any, creditScoring as any, requestContext as any);
  return { useCase, queryRunner: fake.queryRunner, saved: fake.saved, setFound: fake.setFound, creditScoring };
}

const capturedPayload: PaymentEventPayload = {
  transactionId: 'txn-1',
  orderId: 'order-1',
  userId: 'user-1',
  amountCents: 10000,
  currency: 'USD',
};

describe('ActivateInstallmentPlanUseCase', () => {
  it('creates an ACTIVE plan with 3 installments that sum exactly to totalCents', async () => {
    const { useCase, queryRunner, saved } = makeUseCase();

    await useCase.execute(capturedPayload);

    expect(queryRunner.commitTransaction).toHaveBeenCalled();

    const installments = saved.filter((e: any) => e.installmentNumber !== undefined);
    expect(installments).toHaveLength(3);
    const sum = installments.reduce((acc: number, i: any) => acc + i.amountCents, 0);
    expect(sum).toBe(10000);
    // 10000 / 3 = 3333.33... -> 3333, 3333, 3334 (the remainder goes to the last one)
    expect(installments.map((i: any) => i.amountCents)).toEqual([3333, 3333, 3334]);
    expect(installments.map((i: any) => i.originalAmountCents)).toEqual([3333, 3333, 3334]);
    expect(installments.every((i: any) => i.status === InstallmentStatus.PENDING)).toBe(true);
  });

  it('is idempotent: does not create a duplicate plan for an orderId that already has one', async () => {
    const fake = makeFakeQueryRunner();
    fake.setFound({ id: 'plan-1', orderId: 'order-1' });
    const { useCase, queryRunner, saved } = makeUseCase({ queryRunner: fake });

    await useCase.execute(capturedPayload);

    expect(queryRunner.startTransaction).toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it('does not create a plan when the user credit profile is blocked', async () => {
    const { useCase, queryRunner } = makeUseCase({ blocked: true });

    await useCase.execute(capturedPayload);

    expect(queryRunner.startTransaction).not.toHaveBeenCalled();
  });

  it('does not create a plan when the order was paid in full', async () => {
    const { useCase, queryRunner, creditScoring } = makeUseCase();

    await useCase.execute({ ...capturedPayload, paymentMethod: PaymentMethod.FULL });

    expect(queryRunner.startTransaction).not.toHaveBeenCalled();
    expect(creditScoring.getOrCreateProfile).not.toHaveBeenCalled();
  });
});
