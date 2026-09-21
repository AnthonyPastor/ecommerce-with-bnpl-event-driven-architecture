import { InstallmentPlanStatus } from '@bnpl/event-contracts';
import { HoldInstallmentPlanUseCase } from '../../../../src/bnpl/use-cases/hold-installment-plan.use-case';
import { PaymentEventPayload } from '../../../../src/bnpl/use-cases/payment-event-payload';
import { makeFakeQueryRunner } from './query-runner.mock';

function makeUseCase(fake: ReturnType<typeof makeFakeQueryRunner>) {
  const dataSource = { createQueryRunner: jest.fn(() => fake.queryRunner) };
  const creditScoring = { markNeedsRescoring: jest.fn(async () => undefined) };
  return { useCase: new HoldInstallmentPlanUseCase(dataSource as any, creditScoring as any), creditScoring };
}

const payload: PaymentEventPayload = {
  transactionId: 'txn-1',
  orderId: 'order-1',
  userId: 'user-1',
  amountCents: 10000,
  currency: 'USD',
};

describe('HoldInstallmentPlanUseCase', () => {
  it('marks the plan DISPUTED_HOLD and flags the credit profile for rescoring', async () => {
    const fake = makeFakeQueryRunner();
    fake.setFound({ id: 'plan-1', orderId: 'order-1', status: InstallmentPlanStatus.ACTIVE });
    const { useCase, creditScoring } = makeUseCase(fake);

    await useCase.execute(payload);

    expect(fake.saved.some((e: any) => e.status === InstallmentPlanStatus.DISPUTED_HOLD)).toBe(true);
    expect(creditScoring.markNeedsRescoring).toHaveBeenCalledWith('user-1');
  });

  it('is idempotent when the plan is already on hold', async () => {
    const fake = makeFakeQueryRunner();
    fake.setFound({ id: 'plan-1', orderId: 'order-1', status: InstallmentPlanStatus.DISPUTED_HOLD });
    const { useCase, creditScoring } = makeUseCase(fake);

    await useCase.execute(payload);

    expect(fake.queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(fake.saved).toHaveLength(0);
    expect(creditScoring.markNeedsRescoring).not.toHaveBeenCalled();
  });

  it('is a no-op when no plan exists for that orderId', async () => {
    const fake = makeFakeQueryRunner();
    const { useCase, creditScoring } = makeUseCase(fake);

    await useCase.execute(payload);

    expect(fake.queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(creditScoring.markNeedsRescoring).not.toHaveBeenCalled();
  });
});
