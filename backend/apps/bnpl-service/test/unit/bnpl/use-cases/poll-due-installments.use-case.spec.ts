import { PollDueInstallmentsUseCase } from '../../../../src/bnpl/use-cases/poll-due-installments.use-case';

function makeUseCase(due: Array<{ id: string }>) {
  const dataSource = { manager: { find: jest.fn(async () => due) } };
  const chargeDueInstallment = { execute: jest.fn(async () => undefined) };
  return {
    useCase: new PollDueInstallmentsUseCase(dataSource as any, chargeDueInstallment as any),
    dataSource,
    chargeDueInstallment,
  };
}

describe('PollDueInstallmentsUseCase', () => {
  it('does nothing when no installment is due', async () => {
    const { useCase, chargeDueInstallment } = makeUseCase([]);

    await useCase.execute();

    expect(chargeDueInstallment.execute).not.toHaveBeenCalled();
  });

  it('charges every due installment found', async () => {
    const { useCase, chargeDueInstallment } = makeUseCase([{ id: 'installment-1' }, { id: 'installment-2' }]);

    await useCase.execute();

    expect(chargeDueInstallment.execute).toHaveBeenCalledWith({ installmentId: 'installment-1' });
    expect(chargeDueInstallment.execute).toHaveBeenCalledWith({ installmentId: 'installment-2' });
    expect(chargeDueInstallment.execute).toHaveBeenCalledTimes(2);
  });

  it('keeps processing the rest of the batch when one installment throws', async () => {
    const { useCase, chargeDueInstallment } = makeUseCase([{ id: 'installment-1' }, { id: 'installment-2' }]);
    chargeDueInstallment.execute.mockRejectedValueOnce(new Error('boom'));

    await useCase.execute();

    expect(chargeDueInstallment.execute).toHaveBeenCalledTimes(2);
  });
});
