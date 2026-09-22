import { NotFoundException } from '@nestjs/common';
import { CreateOrderDto } from '../../../src/orders/dto/create-order.dto';
import { Order } from '../../../src/orders/entities/order.entity';
import { OrdersService } from '../../../src/orders/orders.service';

function makeFakeQueryRunner(seed?: Record<string, unknown>, existingByIdempotencyKey?: Record<string, unknown> | null) {
  const savedEntities: unknown[] = [];
  let current: any = seed ? { ...seed } : undefined;
  const manager = {
    save: jest.fn(async (entity: any) => {
      savedEntities.push(entity);
      if (entity.status) current = { ...current, ...entity };
      return entity;
    }),
    create: jest.fn((_cls: unknown, data: unknown) => data),
    findOneOrFail: jest.fn(async () => {
      if (!current) throw new Error('not found');
      return current;
    }),
    findOne: jest.fn(async () => existingByIdempotencyKey ?? null),
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
  return { queryRunner, manager, savedEntities };
}

function makeService(overrides?: {
  queryRunner?: ReturnType<typeof makeFakeQueryRunner>['queryRunner'];
  seed?: Record<string, unknown>;
  existingByIdempotencyKey?: Record<string, unknown> | null;
}) {
  const { queryRunner, savedEntities } = overrides?.queryRunner
    ? { queryRunner: overrides.queryRunner, savedEntities: [] as unknown[] }
    : makeFakeQueryRunner(overrides?.seed, overrides?.existingByIdempotencyKey);

  const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
  const ordersRepo = { findOne: jest.fn(), find: jest.fn(), update: jest.fn(async () => ({ affected: 1 })) };
  const requestContext = {
    getCorrelationId: jest.fn(() => 'corr-1'),
    setTransactionId: jest.fn(),
  };

  const service = new OrdersService(dataSource as any, ordersRepo as any, requestContext as any);
  return { service, dataSource, ordersRepo, requestContext, queryRunner, savedEntities };
}

const dto: CreateOrderDto = {
  userId: 'user-1',
  items: [
    { productId: 'p1', name: 'Product 1', unitPriceCents: 1000, quantity: 2 },
    { productId: 'p2', variantId: 'v1', name: 'Product 2', unitPriceCents: 500, quantity: 1 },
  ],
};

describe('OrdersService.createOrder', () => {
  it('computes the total, commits the transaction and saves order + outbox row + status history atomically', async () => {
    const { service, queryRunner, requestContext } = makeService();

    const result = await service.createOrder(dto);

    expect(result.totalCents).toBe(1000 * 2 + 500 * 1);
    expect(queryRunner.startTransaction).toHaveBeenCalled();
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();

    // save() se llama para: Order (por saveWithOutbox), OutboxEvent (por saveWithOutbox), OrderStatusHistory.
    expect(queryRunner.manager.save).toHaveBeenCalledTimes(3);
  });

  it('sets the business transactionId (= order.id) on the request context after commit', async () => {
    const { service, requestContext } = makeService();
    const result = await service.createOrder(dto);
    expect(requestContext.setTransactionId).toHaveBeenCalledWith(result.id);
  });

  it('uses the current correlationId from the request context for the outbox event', async () => {
    const { service, requestContext, queryRunner } = makeService();
    requestContext.getCorrelationId.mockReturnValue('corr-xyz');

    await service.createOrder(dto);

    const outboxCreateCall = (queryRunner.manager.create as jest.Mock).mock.calls.find(
      ([, data]: [unknown, any]) => data?.eventType !== undefined,
    );
    expect(outboxCreateCall?.[1]).toMatchObject({ correlationId: 'corr-xyz' });
  });

  it('rolls back and rethrows if saving fails midway, and still releases the queryRunner', async () => {
    const { queryRunner } = makeFakeQueryRunner();
    (queryRunner.manager.save as jest.Mock).mockRejectedValueOnce(new Error('db exploded'));
    const { service } = makeService({ queryRunner });

    await expect(service.createOrder(dto)).rejects.toThrow('db exploded');

    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
  });

  it('returns the already-created order instead of creating a duplicate when idempotencyKey matches one', async () => {
    const existing = { id: 'order-existing', idempotencyKey: 'cart-1', totalCents: 2500 };
    const { queryRunner } = makeFakeQueryRunner(undefined, existing);
    const { service } = makeService({ queryRunner });

    const result = await service.createOrder({ ...dto, idempotencyKey: 'cart-1' });

    expect(result).toBe(existing);
    expect(queryRunner.manager.save).not.toHaveBeenCalled();
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
  });

  it('creates a new order and persists idempotencyKey when no existing order matches it', async () => {
    const { service, queryRunner } = makeService({ existingByIdempotencyKey: null });

    const result = await service.createOrder({ ...dto, idempotencyKey: 'cart-2' });

    expect(result.idempotencyKey).toBe('cart-2');
    expect(queryRunner.manager.save).toHaveBeenCalled();
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
  });
});

describe('OrdersService.findById / findByUserId', () => {
  it('returns the order with a computed paymentStatus when found', async () => {
    const { service, ordersRepo } = makeService();
    const order = { id: 'order-1', status: 'CREATED', paymentMethod: null } as unknown as Order;
    ordersRepo.findOne.mockResolvedValue(order);

    await expect(service.findById('order-1')).resolves.toEqual({ ...order, paymentStatus: 'UNPAID' });
  });

  it('throws NotFoundException when the order does not exist', async () => {
    const { service, ordersRepo } = makeService();
    ordersRepo.findOne.mockResolvedValue(null);

    await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
  });

  it('lists orders by userId newest first, each with a computed paymentStatus', async () => {
    const { service, ordersRepo } = makeService();
    const order = { id: 'order-1', status: 'CREATED', paymentMethod: null } as unknown as Order;
    ordersRepo.find.mockResolvedValue([order]);

    const result = await service.findByUserId('user-1');

    expect(ordersRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
    expect(result).toEqual([{ ...order, paymentStatus: 'UNPAID' }]);
  });

  it.each([
    ['CREATED', null, 'UNPAID'],
    ['CONFIRMED', 'FULL', 'PAID'],
    ['CONFIRMED', 'INSTALLMENTS', 'INSTALLMENTS_PENDING'],
  ] as const)('status %s + paymentMethod %s -> paymentStatus %s', async (status, paymentMethod, expected) => {
    const { service, ordersRepo } = makeService();
    const order = { id: 'order-1', status, paymentMethod } as unknown as Order;
    ordersRepo.findOne.mockResolvedValue(order);

    const result = await service.findById('order-1');

    expect(result.paymentStatus).toBe(expected);
  });
});

describe('OrdersService.markConfirmed', () => {
  it('transitions the order to CONFIRMED, persists the paymentMethod, and writes the outbox event', async () => {
    const { queryRunner } = makeFakeQueryRunner({ id: 'order-1', status: 'CREATED', userId: 'user-1' });
    const { service } = makeService({ queryRunner });

    await service.markConfirmed('order-1', 'FULL' as any);

    expect(queryRunner.manager.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CONFIRMED', paymentMethod: 'FULL' }),
    );
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
  });

  it('persists a null paymentMethod when the event payload did not carry one', async () => {
    const { queryRunner } = makeFakeQueryRunner({ id: 'order-1', status: 'CREATED', userId: 'user-1' });
    const { service } = makeService({ queryRunner });

    await service.markConfirmed('order-1', null);

    expect(queryRunner.manager.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CONFIRMED', paymentMethod: null }),
    );
  });

  it('is idempotent: does nothing if the order is already CONFIRMED', async () => {
    const { queryRunner } = makeFakeQueryRunner({ id: 'order-1', status: 'CONFIRMED', userId: 'user-1' });
    const { service } = makeService({ queryRunner });

    await service.markConfirmed('order-1', 'FULL' as any);

    expect(queryRunner.manager.save).not.toHaveBeenCalled();
  });

  it('does nothing if the order has moved past CREATED some other way (e.g. REFUNDED)', async () => {
    const { queryRunner } = makeFakeQueryRunner({ id: 'order-1', status: 'REFUNDED', userId: 'user-1' });
    const { service } = makeService({ queryRunner });

    await service.markConfirmed('order-1', 'FULL' as any);

    expect(queryRunner.manager.save).not.toHaveBeenCalled();
  });
});

describe('OrdersService.markRefunded', () => {
  it('transitions the order to REFUNDED and writes the outbox event', async () => {
    const { queryRunner } = makeFakeQueryRunner({ id: 'order-1', status: 'CREATED', userId: 'user-1' });
    const { service } = makeService({ queryRunner });

    await service.markRefunded('order-1');

    expect(queryRunner.manager.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'REFUNDED' }),
    );
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
  });

  it('is idempotent: does nothing if the order is already REFUNDED', async () => {
    const { queryRunner } = makeFakeQueryRunner({ id: 'order-1', status: 'REFUNDED', userId: 'user-1' });
    const { service } = makeService({ queryRunner });

    await service.markRefunded('order-1');

    expect(queryRunner.manager.save).not.toHaveBeenCalled();
  });
});

describe('OrdersService.clearPaymentIncident', () => {
  it('clears paymentIncident back to null', async () => {
    const { service, ordersRepo } = makeService();

    await service.clearPaymentIncident('order-1');

    expect(ordersRepo.update).toHaveBeenCalledWith({ id: 'order-1' }, { paymentIncident: null });
  });

  it('throws NotFoundException when the order does not exist', async () => {
    const { service, ordersRepo } = makeService();
    ordersRepo.update.mockResolvedValueOnce({ affected: 0 } as never);

    await expect(service.clearPaymentIncident('missing-order')).rejects.toThrow(NotFoundException);
  });
});
