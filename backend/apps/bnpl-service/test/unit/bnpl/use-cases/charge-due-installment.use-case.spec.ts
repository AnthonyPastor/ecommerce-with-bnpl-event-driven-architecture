import { InstallmentStatus } from '@bnpl/event-contracts';
import { ChargeDueInstallmentUseCase } from '../../../../src/bnpl/use-cases/charge-due-installment.use-case';
import { makeFakeQueryRunner } from './query-runner.mock';

const plan = { id: 'plan-1', orderId: 'order-1', userId: 'user-1', currency: 'USD' };

function makeUseCase(fake: ReturnType<typeof makeFakeQueryRunner>, foundPlan: typeof plan | null = plan) {
  const dataSource = {
    manager: { findOne: jest.fn(async () => foundPlan) },
    createQueryRunner: jest.fn(() => fake.queryRunner),
  };
  const rabbitPublisher = { publish: jest.fn(() => true) };
  const requestContext = {
    getCorrelationId: jest.fn(() => 'corr-1'),
    run: jest.fn((_ctx: unknown, fn: () => void) => fn()),
  };
  return {
    useCase: new ChargeDueInstallmentUseCase(dataSource as any, rabbitPublisher as any, requestContext as any),
    dataSource,
    rabbitPublisher,
  };
}

const now = Date.now();
const dueInThePast = new Date(now - 1000);

describe('ChargeDueInstallmentUseCase', () => {
  it('marks a PENDING installment DUE, publishes bnpl.installment.due.v1, and publishes the charge command', async () => {
    const fake = makeFakeQueryRunner();
    fake.setFound({
      id: 'installment-1',
      status: InstallmentStatus.PENDING,
      amountCents: 3333,
      retryCount: 0,
      dueDate: dueInThePast,
    });
    const { useCase, rabbitPublisher } = makeUseCase(fake);

    await useCase.execute({ installmentId: 'installment-1' });

    expect(fake.saved.some((e: any) => e.status === InstallmentStatus.DUE)).toBe(true);
    expect(fake.queryRunner.commitTransaction).toHaveBeenCalled();
    expect(rabbitPublisher.publish).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        installmentId: 'installment-1',
        planId: 'plan-1',
        orderId: 'order-1',
        userId: 'user-1',
        amountCents: 3333,
        currency: 'USD',
        attempt: 1,
      }),
    );
  });

  it('republishes the charge command for an installment already DUE, without touching its status', async () => {
    const fake = makeFakeQueryRunner();
    fake.setFound({
      id: 'installment-1',
      status: InstallmentStatus.DUE,
      amountCents: 3333,
      retryCount: 1,
      dueDate: dueInThePast,
    });
    const { useCase, rabbitPublisher } = makeUseCase(fake);

    await useCase.execute({ installmentId: 'installment-1' });

    expect(fake.saved).toHaveLength(0);
    expect(rabbitPublisher.publish).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ installmentId: 'installment-1', attempt: 2 }),
    );
  });

  it('is a no-op when the installment is not chargeable (e.g. already PAID)', async () => {
    const fake = makeFakeQueryRunner();
    fake.setFound({ id: 'installment-1', status: InstallmentStatus.PAID, dueDate: dueInThePast });
    const { useCase, rabbitPublisher } = makeUseCase(fake);

    await useCase.execute({ installmentId: 'installment-1' });

    expect(fake.queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(rabbitPublisher.publish).not.toHaveBeenCalled();
  });

  it('is a no-op when no plan is found for the installment', async () => {
    const fake = makeFakeQueryRunner();
    const { useCase, rabbitPublisher } = makeUseCase(fake, null);

    await useCase.execute({ installmentId: 'installment-1' });

    expect(fake.queryRunner.connect).not.toHaveBeenCalled();
    expect(rabbitPublisher.publish).not.toHaveBeenCalled();
  });
});
