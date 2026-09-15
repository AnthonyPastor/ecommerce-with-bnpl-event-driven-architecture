import { InstallmentPlanStatus, InstallmentStatus } from '@bnpl/event-contracts';
import { BnplService, PaymentEventPayload } from '../../../src/bnpl/bnpl.service';
import { InstallmentPlan } from '../../../src/bnpl/entities/installment-plan.entity';

function makeFakeQueryRunner() {
  const saved: any[] = [];
  const manager = {
    save: jest.fn(async (entity: any) => {
      saved.push({ ...entity });
      return entity;
    }),
    create: jest.fn((_cls: unknown, data: unknown) => data),
  };
  const queryRunner = {
    manager,
    connect: jest.fn(async () => undefined),
    startTransaction: jest.fn(async () => undefined),
    commitTransaction: jest.fn(async () => undefined),
    rollbackTransaction: jest.fn(async () => undefined),
    release: jest.fn(async () => undefined),
  };
  return { queryRunner, saved };
}

function makeService(opts?: {
  existingPlan?: InstallmentPlan | null;
  blocked?: boolean;
  queryRunner?: ReturnType<typeof makeFakeQueryRunner>['queryRunner'];
}) {
  const fake = opts?.queryRunner ? { queryRunner: opts.queryRunner, saved: [] as any[] } : makeFakeQueryRunner();
  const dataSource = { createQueryRunner: jest.fn(() => fake.queryRunner) };
  const plansRepo = {
    findOne: jest.fn(async () => (opts?.existingPlan === undefined ? null : opts.existingPlan)),
    find: jest.fn(async () => []),
    save: jest.fn(async (data: any) => data),
  };
  const creditScoring = {
    getOrCreateProfile: jest.fn(async () => ({ userId: 'user-1', blocked: opts?.blocked ?? false })),
    scoreUser: jest.fn(async () => ({ approved: true })),
    markNeedsRescoring: jest.fn(async () => undefined),
  };
  const requestContext = { getCorrelationId: jest.fn(() => 'corr-1') };

  const service = new BnplService(
    dataSource as any,
    plansRepo as any,
    creditScoring as any,
    requestContext as any,
  );
  return { service, dataSource, plansRepo, creditScoring, queryRunner: fake.queryRunner, saved: fake.saved };
}

const capturedPayload: PaymentEventPayload = {
  transactionId: 'txn-1',
  orderId: 'order-1',
  userId: 'user-1',
  amountCents: 10000,
  currency: 'USD',
};

describe('BnplService.activatePlanForCapturedPayment', () => {
  it('creates an ACTIVE plan with 3 installments that sum exactly to totalCents', async () => {
    const { service, queryRunner, saved } = makeService();

    await service.activatePlanForCapturedPayment(capturedPayload);

    expect(queryRunner.commitTransaction).toHaveBeenCalled();

    const installments = saved.filter((e) => e.installmentNumber !== undefined);
    expect(installments).toHaveLength(3);
    const sum = installments.reduce((acc, i) => acc + i.amountCents, 0);
    expect(sum).toBe(10000);
    // 10000 / 3 = 3333.33... -> 3333, 3333, 3334 (the remainder goes to the last one)
    expect(installments.map((i) => i.amountCents)).toEqual([3333, 3333, 3334]);
    expect(installments.every((i) => i.status === InstallmentStatus.PENDING)).toBe(true);
  });

  it('is idempotent: does not create a duplicate plan for an orderId that already has one', async () => {
    const { service, queryRunner } = makeService({
      existingPlan: { id: 'plan-1', orderId: 'order-1' } as InstallmentPlan,
    });

    await service.activatePlanForCapturedPayment(capturedPayload);

    expect(queryRunner.startTransaction).not.toHaveBeenCalled();
  });

  it('does not create a plan when the user credit profile is blocked', async () => {
    const { service, queryRunner } = makeService({ blocked: true });

    await service.activatePlanForCapturedPayment(capturedPayload);

    expect(queryRunner.startTransaction).not.toHaveBeenCalled();
  });
});

describe('BnplService.cancelPlanForRefund', () => {
  it('cancels every still-pending installment and marks the plan CANCELLED', async () => {
    const installments = [
      { id: 'i1', status: InstallmentStatus.PENDING },
      { id: 'i2', status: InstallmentStatus.PAID },
    ];
    const { queryRunner, saved } = makeFakeQueryRunner();
    const { service, plansRepo } = makeService({ queryRunner });
    plansRepo.findOne.mockResolvedValue({
      id: 'plan-1',
      orderId: 'order-1',
      totalCents: 10000,
      installments,
    } as any);

    await service.cancelPlanForRefund(capturedPayload);

    expect(installments[0].status).toBe(InstallmentStatus.CANCELLED);
    expect(installments[1].status).toBe(InstallmentStatus.PAID); // already paid, not touched
    expect(saved.some((e) => e.status === InstallmentPlanStatus.CANCELLED)).toBe(true);
  });

  it('is a no-op when no plan exists for that orderId', async () => {
    const { service, queryRunner, plansRepo } = makeService();
    plansRepo.findOne.mockResolvedValue(null);

    await service.cancelPlanForRefund(capturedPayload);

    expect(queryRunner.startTransaction).not.toHaveBeenCalled();
  });
});

describe('BnplService.adjustPlanForPartialRefund', () => {
  it('reduces pending installment amounts proportionally to the refunded amount', async () => {
    const installments = [
      { id: 'i1', status: InstallmentStatus.PENDING, amountCents: 3333 },
      { id: 'i2', status: InstallmentStatus.PENDING, amountCents: 3333 },
      { id: 'i3', status: InstallmentStatus.PAID, amountCents: 3334 },
    ];
    const { queryRunner, saved } = makeFakeQueryRunner();
    const { service, plansRepo } = makeService({ queryRunner });
    plansRepo.findOne.mockResolvedValue({
      id: 'plan-1',
      orderId: 'order-1',
      totalCents: 10000,
      installments,
    } as any);

    await service.adjustPlanForPartialRefund({ ...capturedPayload, amountCents: 5000 });

    // factor = (10000 - 5000) / 10000 = 0.5
    expect(installments[0].amountCents).toBe(Math.round(3333 * 0.5));
    expect(installments[1].amountCents).toBe(Math.round(3333 * 0.5));
    expect(installments[2].amountCents).toBe(3334); // already paid, not touched
    expect(saved.some((e) => e.status === InstallmentPlanStatus.ADJUSTED)).toBe(true);
  });
});

describe('BnplService.holdPlanForChargeback', () => {
  it('marks the plan DISPUTED_HOLD and flags the credit profile for rescoring', async () => {
    const { service, plansRepo, creditScoring } = makeService();
    plansRepo.findOne.mockResolvedValue({ id: 'plan-1', orderId: 'order-1' } as any);

    await service.holdPlanForChargeback(capturedPayload);

    expect(plansRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: InstallmentPlanStatus.DISPUTED_HOLD }),
    );
    expect(creditScoring.markNeedsRescoring).toHaveBeenCalledWith('user-1');
  });
});
