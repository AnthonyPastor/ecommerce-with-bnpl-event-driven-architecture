import { InstallmentPlanStatus, InstallmentStatus } from '@bnpl/event-contracts';
import { AdjustInstallmentPlanUseCase } from '../../../../src/bnpl/use-cases/adjust-installment-plan.use-case';
import { PaymentEventPayload } from '../../../../src/bnpl/use-cases/payment-event-payload';
import { makeFakeQueryRunner } from './query-runner.mock';

function makeUseCase(fake: ReturnType<typeof makeFakeQueryRunner>) {
  const dataSource = { createQueryRunner: jest.fn(() => fake.queryRunner) };
  const requestContext = { getCorrelationId: jest.fn(() => 'corr-1') };
  return new AdjustInstallmentPlanUseCase(dataSource as any, requestContext as any);
}

const payload: PaymentEventPayload = {
  transactionId: 'txn-1',
  orderId: 'order-1',
  userId: 'user-1',
  amountCents: 10000,
  currency: 'USD',
};

function makePlan(overrides: Partial<{ refundedAmountCents: number; lastRefundEventId: string | null }> = {}) {
  return {
    id: 'plan-1',
    orderId: 'order-1',
    totalCents: 10000,
    refundedAmountCents: overrides.refundedAmountCents ?? 0,
    lastRefundEventId: overrides.lastRefundEventId ?? null,
    status: InstallmentPlanStatus.ACTIVE,
    installments: [
      { id: 'i1', status: InstallmentStatus.PENDING, amountCents: 3333, originalAmountCents: 3333 },
      { id: 'i2', status: InstallmentStatus.PENDING, amountCents: 3333, originalAmountCents: 3333 },
      { id: 'i3', status: InstallmentStatus.PAID, amountCents: 3334, originalAmountCents: 3334 },
    ],
  };
}

describe('AdjustInstallmentPlanUseCase', () => {
  it('reduces pending installment amounts proportionally to the total refunded so far', async () => {
    const plan = makePlan();
    const fake = makeFakeQueryRunner();
    fake.setFound(plan);
    const useCase = makeUseCase(fake);

    await useCase.execute({ payload: { ...payload, amountCents: 5000 }, eventId: 'evt-1' });

    // factor = (10000 - 5000) / 10000 = 0.5
    expect(plan.installments[0].amountCents).toBe(Math.round(3333 * 0.5));
    expect(plan.installments[1].amountCents).toBe(Math.round(3333 * 0.5));
    expect(plan.installments[2].amountCents).toBe(3334); // already paid, not touched
    expect(plan.refundedAmountCents).toBe(5000);
    expect(plan.lastRefundEventId).toBe('evt-1');
    expect(fake.saved.some((e: any) => e.status === InstallmentPlanStatus.ADJUSTED)).toBe(true);
  });

  it('is a no-op when the same event is redelivered', async () => {
    const plan = makePlan({ refundedAmountCents: 5000, lastRefundEventId: 'evt-1' });
    const beforeAmounts = plan.installments.map((i) => i.amountCents);
    const fake = makeFakeQueryRunner();
    fake.setFound(plan);
    const useCase = makeUseCase(fake);

    await useCase.execute({ payload: { ...payload, amountCents: 5000 }, eventId: 'evt-1' });

    expect(plan.installments.map((i) => i.amountCents)).toEqual(beforeAmounts);
    expect(fake.queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(fake.queryRunner.commitTransaction).not.toHaveBeenCalled();
  });

  it('applies a second, legitimate partial refund cumulatively instead of compounding', async () => {
    // Plan already reflects a first partial refund of 5000 (applied by a previous call).
    const plan = makePlan({ refundedAmountCents: 5000, lastRefundEventId: 'evt-1' });
    plan.installments[0].amountCents = Math.round(3333 * 0.5);
    plan.installments[1].amountCents = Math.round(3333 * 0.5);
    const fake = makeFakeQueryRunner();
    fake.setFound(plan);
    const useCase = makeUseCase(fake);

    // A second, different partial refund of 2000 arrives.
    await useCase.execute({ payload: { ...payload, amountCents: 2000 }, eventId: 'evt-2' });

    // Combined refunded total is 7000, factor = (10000 - 7000) / 10000 = 0.3,
    // applied to the ORIGINAL amounts (3333), not the already-shrunk ones.
    expect(plan.refundedAmountCents).toBe(7000);
    expect(plan.installments[0].amountCents).toBe(Math.round(3333 * 0.3));
    expect(plan.installments[1].amountCents).toBe(Math.round(3333 * 0.3));
    expect(plan.lastRefundEventId).toBe('evt-2');
  });

  it('is a no-op when no plan exists for that orderId', async () => {
    const fake = makeFakeQueryRunner();
    const useCase = makeUseCase(fake);

    await useCase.execute({ payload, eventId: 'evt-1' });

    expect(fake.queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(fake.queryRunner.commitTransaction).not.toHaveBeenCalled();
  });
});
