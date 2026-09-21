/** Shared fake `QueryRunner` for the bnpl-service use-case specs — one row lookup slot (`setFound`) plus a `saved` log of every `manager.save` call. */
export function makeFakeQueryRunner() {
  const saved: unknown[] = [];
  let found: unknown = null;

  const manager = {
    findOne: jest.fn(async () => found),
    // `CancelInstallmentPlanUseCase`/`AdjustInstallmentPlanUseCase` load the
    // plan's installments with a separate `manager.find()` call (not a
    // relations-eager `findOne`, which Postgres rejects combined with a
    // pessimistic lock on the outer-joined side) — default to whatever
    // `installments` array was set on the found entity, so specs can keep
    // shaping it via `setFound({ ..., installments: [...] })`.
    find: jest.fn(async () => (found as any)?.installments ?? []),
    save: jest.fn(async (entity: any) => {
      saved.push({ ...entity });
      return entity;
    }),
    create: jest.fn((_cls: unknown, data: unknown) => data),
  };

  const queryRunner = {
    manager,
    query: jest.fn(async () => undefined),
    connect: jest.fn(async () => undefined),
    startTransaction: jest.fn(async () => undefined),
    commitTransaction: jest.fn(async () => undefined),
    rollbackTransaction: jest.fn(async () => undefined),
    release: jest.fn(async () => undefined),
  };

  return {
    queryRunner,
    saved,
    setFound: (entity: unknown) => {
      found = entity;
    },
  };
}
