import { InstallmentPlanStatus, InstallmentStatus } from '@bnpl/event-contracts';
import { CancelInstallmentPlanUseCase } from '../../../../src/bnpl/use-cases/cancel-installment-plan.use-case';
import { PaymentEventPayload } from '../../../../src/bnpl/use-cases/payment-event-payload';
import { makeFakeQueryRunner } from './query-runner.mock';

function makeUseCase(fake: ReturnType<typeof makeFakeQueryRunner>) {
  const dataSource = { createQueryRunner: jest.fn(() => fake.queryRunner) };
  const requestContext = { getCorrelationId: jest.fn(() => 'corr-1') };
  return new CancelInstallmentPlanUseCase(dataSource as any, requestContext as any);
}

const payload: PaymentEventPayload = {
  transactionId: 'txn-1',
  orderId: 'order-1',
  userId: 'user-1',
  amountCents: 10000,
  currency: 'USD',
};

describe('CancelInstallmentPlanUseCase', () => {
  it('cancels every still-pending installment and marks the plan CANCELLED', async () => {
    const installments = [
      { id: 'i1', status: InstallmentStatus.PENDING },
      { id: 'i2', status: InstallmentStatus.PAID },
    ];
    const fake = makeFakeQueryRunner();
    fake.setFound({ id: 'plan-1', orderId: 'order-1', status: InstallmentPlanStatus.ACTIVE, installments });
    const useCase = makeUseCase(fake);

    await useCase.execute(payload);

    expect(installments[0].status).toBe(InstallmentStatus.CANCELLED);
    expect(installments[1].status).toBe(InstallmentStatus.PAID); // already paid, not touched
    expect(fake.saved.some((e: any) => e.status === InstallmentPlanStatus.CANCELLED)).toBe(true);
    expect(fake.queryRunner.commitTransaction).toHaveBeenCalled();
  });

  it('is a no-op when no plan exists for that orderId', async () => {
    const fake = makeFakeQueryRunner();
    const useCase = makeUseCase(fake);

    await useCase.execute(payload);

    expect(fake.queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(fake.queryRunner.commitTransaction).not.toHaveBeenCalled();
  });

  it('is idempotent when the plan is already CANCELLED (redelivered event)', async () => {
    const installments = [{ id: 'i1', status: InstallmentStatus.CANCELLED }];
    const fake = makeFakeQueryRunner();
    fake.setFound({ id: 'plan-1', orderId: 'order-1', status: InstallmentPlanStatus.CANCELLED, installments });
    const useCase = makeUseCase(fake);

    await useCase.execute(payload);

    expect(fake.queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(fake.queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(fake.saved).toHaveLength(0);
  });
});
