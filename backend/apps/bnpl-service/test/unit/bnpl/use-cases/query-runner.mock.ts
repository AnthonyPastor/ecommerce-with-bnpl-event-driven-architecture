/** Shared fake `QueryRunner` for the bnpl-service use-case specs — one row lookup slot (`setFound`) plus a `saved` log of every `manager.save` call. */
export function makeFakeQueryRunner() {
  const saved: unknown[] = [];
  let found: unknown = null;

  const manager = {
    findOne: jest.fn(async () => found),
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
