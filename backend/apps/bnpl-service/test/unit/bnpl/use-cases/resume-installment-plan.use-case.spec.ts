import { InstallmentPlanStatus } from '@bnpl/event-contracts';
import { ResumeInstallmentPlanUseCase } from '../../../../src/bnpl/use-cases/resume-installment-plan.use-case';
import { PaymentEventPayload } from '../../../../src/bnpl/use-cases/payment-event-payload';
import { makeFakeQueryRunner } from './query-runner.mock';

function makeUseCase(fake: ReturnType<typeof makeFakeQueryRunner>) {
  const dataSource = { createQueryRunner: jest.fn(() => fake.queryRunner) };
  return { useCase: new ResumeInstallmentPlanUseCase(dataSource as any) };
}

const payload: PaymentEventPayload = {
  transactionId: 'txn-1',
  orderId: 'order-1',
  userId: 'user-1',
  amountCents: 10000,
  currency: 'USD',
};

describe('ResumeInstallmentPlanUseCase', () => {
  it('takes the plan off DISPUTED_HOLD back to ACTIVE', async () => {
    const fake = makeFakeQueryRunner();
    fake.setFound({ id: 'plan-1', orderId: 'order-1', status: InstallmentPlanStatus.DISPUTED_HOLD });
    const { useCase } = makeUseCase(fake);

    await useCase.execute(payload);

    expect(fake.saved.some((e: any) => e.status === InstallmentPlanStatus.ACTIVE)).toBe(true);
  });

  it('is idempotent when the plan is not on hold', async () => {
    const fake = makeFakeQueryRunner();
    fake.setFound({ id: 'plan-1', orderId: 'order-1', status: InstallmentPlanStatus.ACTIVE });
    const { useCase } = makeUseCase(fake);

    await useCase.execute(payload);

    expect(fake.queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(fake.saved).toHaveLength(0);
  });

  it('is a no-op when no plan exists for that orderId', async () => {
    const fake = makeFakeQueryRunner();
    const { useCase } = makeUseCase(fake);

    await useCase.execute(payload);

    expect(fake.queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(fake.saved).toHaveLength(0);
  });
});
