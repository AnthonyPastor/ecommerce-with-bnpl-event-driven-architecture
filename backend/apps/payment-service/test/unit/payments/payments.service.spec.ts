import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Transaction } from '../../../src/payments/entities/transaction.entity';
import { PaymentsService } from '../../../src/payments/payments.service';
import { PaymentStatus } from '../../../src/payments/payment-state-machine';

function makeFakeQueryRunner(initialTransaction: Partial<Transaction>, existingForOrder: Partial<Transaction>[]) {
  let current: Transaction = { ...initialTransaction } as Transaction;
  const manager = {
    findOneOrFail: jest.fn(async () => current),
    find: jest.fn(async () => existingForOrder),
    save: jest.fn(async (entity: any) => {
      if (entity.status) current = { ...current, ...entity };
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
  return { queryRunner, getCurrent: () => current };
}

function makeService(txnState: Partial<Transaction>, existingForOrder: Partial<Transaction>[] = []) {
  const { queryRunner, getCurrent } = makeFakeQueryRunner(txnState, existingForOrder);
  const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
  const transactionsRepo = {
    create: jest.fn((data: any) => data),
    save: jest.fn(async (data: any) => data),
    findOne: jest.fn(async () => getCurrent()),
    findOneOrFail: jest.fn(async () => getCurrent()),
    find: jest.fn(async () => existingForOrder),
  };
  const requestContext = {
    getCorrelationId: jest.fn(() => 'corr-1'),
    getTransactionId: jest.fn(() => undefined),
    setTransactionId: jest.fn(),
  };
  const gateway = {
    authorize: jest.fn(async () => ({ gatewayReference: 'fake_txn-1' })),
    capture: jest.fn(),
    refund: jest.fn(),
    void: jest.fn(),
    verifyWebhookSignature: jest.fn(),
    parseWebhookPayload: jest.fn(),
  };

  const service = new PaymentsService(
    dataSource as any,
    transactionsRepo as any,
    gateway as any,
    requestContext as any,
  );
  return { service, queryRunner, transactionsRepo, requestContext, gateway, getCurrent };
}

describe('PaymentsService.createPayment', () => {
  it('creates a PENDING transaction, authorizes it, and transitions to AUTHORIZED', async () => {
    const { service, transactionsRepo, gateway, queryRunner } = makeService({
      id: 'txn-1',
      status: PaymentStatus.PENDING,
      orderId: 'order-1',
    });

    const result = await service.createPayment({
      orderId: 'order-1',
      userId: 'user-1',
      amountCents: 1000,
    });

    expect(queryRunner.manager.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: PaymentStatus.PENDING }),
    );
    expect(gateway.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 1000, currency: 'USD' }),
    );
    expect(result.status).toBe(PaymentStatus.AUTHORIZED);
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
  });

  it('transitions to AUTHORIZATION_FAILED and rethrows when the gateway rejects', async () => {
    const { service, gateway } = makeService({
      id: 'txn-1',
      status: PaymentStatus.PENDING,
      orderId: 'order-1',
    });
    gateway.authorize.mockRejectedValue(new Error('card declined'));

    await expect(
      service.createPayment({ orderId: 'order-1', userId: 'user-1', amountCents: 1000 }),
    ).rejects.toThrow('card declined');
  });

  it('rejects a second payment for an order that already has a CAPTURED transaction', async () => {
    const { service } = makeService(
      { id: 'txn-1', status: PaymentStatus.PENDING, orderId: 'order-1' },
      [{ id: 'txn-0', status: PaymentStatus.CAPTURED, orderId: 'order-1' }],
    );

    await expect(
      service.createPayment({ orderId: 'order-1', userId: 'user-1', amountCents: 1000 }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects a second payment for an order with an in-flight (AUTHORIZED) transaction', async () => {
    const { service } = makeService(
      { id: 'txn-1', status: PaymentStatus.PENDING, orderId: 'order-1' },
      [{ id: 'txn-0', status: PaymentStatus.AUTHORIZED, orderId: 'order-1' }],
    );

    await expect(
      service.createPayment({ orderId: 'order-1', userId: 'user-1', amountCents: 1000 }),
    ).rejects.toThrow(ConflictException);
  });

  it('allows a retry when every prior transaction for the order failed', async () => {
    const { service, queryRunner } = makeService(
      { id: 'txn-1', status: PaymentStatus.PENDING, orderId: 'order-1' },
      [
        { id: 'txn-0', status: PaymentStatus.AUTHORIZATION_FAILED, orderId: 'order-1' },
        { id: 'txn-0b', status: PaymentStatus.CAPTURE_FAILED, orderId: 'order-1' },
      ],
    );

    const result = await service.createPayment({ orderId: 'order-1', userId: 'user-1', amountCents: 1000 });

    expect(result.status).toBe(PaymentStatus.AUTHORIZED);
    expect(queryRunner.manager.save).toHaveBeenCalled();
  });

  it('allows a retry when the order was fully refunded', async () => {
    const { service } = makeService(
      { id: 'txn-1', status: PaymentStatus.PENDING, orderId: 'order-1' },
      [{ id: 'txn-0', status: PaymentStatus.REFUNDED, orderId: 'order-1' }],
    );

    const result = await service.createPayment({ orderId: 'order-1', userId: 'user-1', amountCents: 1000 });

    expect(result.status).toBe(PaymentStatus.AUTHORIZED);
  });
});

describe('PaymentsService.findByOrderId', () => {
  it("returns the requesting user's transactions for the order, most recent first, via the repository", async () => {
    const { service, transactionsRepo } = makeService({}, [{ id: 'txn-2' }, { id: 'txn-1' }] as Transaction[]);

    const result = await service.findByOrderId('order-1', 'user-1');

    expect(transactionsRepo.find).toHaveBeenCalledWith({
      where: { orderId: 'order-1', userId: 'user-1' },
      order: { createdAt: 'DESC' },
    });
    expect(result).toEqual([{ id: 'txn-2' }, { id: 'txn-1' }]);
  });
});

describe('PaymentsService.processWebhookEvent', () => {
  it('transitions AUTHORIZED -> CAPTURED on a capture_succeeded event', async () => {
    const { service, getCurrent } = makeService({
      id: 'txn-1',
      status: PaymentStatus.AUTHORIZED,
      orderId: 'order-1',
      userId: 'user-1',
      amountCents: 1000,
      currency: 'USD',
    });

    await service.processWebhookEvent('txn-1', {
      externalEventId: 'evt-1',
      gatewayReference: 'fake_txn-1',
      eventType: 'capture_succeeded',
      amountCents: 1000,
    });

    expect(getCurrent().status).toBe(PaymentStatus.CAPTURED);
  });

  it('ignores webhook event types with no mapped transition (e.g. chargeback)', async () => {
    const { service, queryRunner } = makeService({
      id: 'txn-1',
      status: PaymentStatus.CAPTURED,
      orderId: 'order-1',
    });

    await service.processWebhookEvent('txn-1', {
      externalEventId: 'evt-2',
      gatewayReference: 'fake_txn-1',
      eventType: 'chargeback',
    });

    expect(queryRunner.startTransaction).not.toHaveBeenCalled();
  });

  it('rejects an invalid transition (e.g. capture_succeeded on an already CAPTURED transaction)', async () => {
    const { service } = makeService({
      id: 'txn-1',
      status: PaymentStatus.CAPTURED,
      orderId: 'order-1',
    });

    await expect(
      service.processWebhookEvent('txn-1', {
        externalEventId: 'evt-3',
        gatewayReference: 'fake_txn-1',
        eventType: 'capture_succeeded',
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });
});

describe('PaymentsService.findById', () => {
  it('throws NotFoundException when missing', async () => {
    const { service, transactionsRepo } = makeService({});
    transactionsRepo.findOne.mockResolvedValue(null as any);
    await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
  });
});

describe('PaymentsService partial refunds via processWebhookEvent', () => {
  it('a refund smaller than the total moves the transaction to PARTIALLY_REFUNDED and accumulates refundedAmountCents', async () => {
    const { service, getCurrent } = makeService({
      id: 'txn-1',
      status: PaymentStatus.CAPTURED,
      orderId: 'order-1',
      userId: 'user-1',
      amountCents: 1000,
      refundedAmountCents: 0,
      currency: 'USD',
    });

    await service.processWebhookEvent('txn-1', {
      externalEventId: 'evt-1',
      gatewayReference: 'fake_txn-1',
      eventType: 'refund_succeeded',
      amountCents: 400,
    });

    expect(getCurrent().status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
    expect(getCurrent().refundedAmountCents).toBe(400);
  });

  it('a refund that covers the remaining balance moves the transaction to REFUNDED', async () => {
    const { service, getCurrent } = makeService({
      id: 'txn-1',
      status: PaymentStatus.PARTIALLY_REFUNDED,
      orderId: 'order-1',
      userId: 'user-1',
      amountCents: 1000,
      refundedAmountCents: 400,
      currency: 'USD',
    });

    await service.processWebhookEvent('txn-1', {
      externalEventId: 'evt-2',
      gatewayReference: 'fake_txn-1',
      eventType: 'refund_succeeded',
      amountCents: 600,
    });

    expect(getCurrent().status).toBe(PaymentStatus.REFUNDED);
    expect(getCurrent().refundedAmountCents).toBe(1000);
  });
});

describe('PaymentsService.refundPayment', () => {
  it('rejects refunding a transaction that is not CAPTURED/PARTIALLY_REFUNDED', async () => {
    const { service } = makeService({ id: 'txn-1', status: PaymentStatus.AUTHORIZED, amountCents: 1000, refundedAmountCents: 0 });
    await expect(service.refundPayment('txn-1')).rejects.toThrow(BadRequestException);
  });

  it('defaults to a full refund of the remaining balance and calls gateway.refund', async () => {
    const { service, gateway } = makeService({
      id: 'txn-1',
      status: PaymentStatus.CAPTURED,
      amountCents: 1000,
      refundedAmountCents: 200,
      gatewayReference: 'fake_txn-1',
    });

    await service.refundPayment('txn-1');

    expect(gateway.refund).toHaveBeenCalledWith(
      expect.objectContaining({ gatewayReference: 'fake_txn-1', amountCents: 800 }),
    );
  });

  it('rejects a refund amount greater than the remaining refundable balance', async () => {
    const { service } = makeService({
      id: 'txn-1',
      status: PaymentStatus.CAPTURED,
      amountCents: 1000,
      refundedAmountCents: 0,
      gatewayReference: 'fake_txn-1',
    });

    await expect(service.refundPayment('txn-1', 1001)).rejects.toThrow(BadRequestException);
  });
});

describe('PaymentsService.voidPayment', () => {
  it('rejects voiding a transaction that is not AUTHORIZED', async () => {
    const { service } = makeService({ id: 'txn-1', status: PaymentStatus.CAPTURED, gatewayReference: 'fake_txn-1' });
    await expect(service.voidPayment('txn-1')).rejects.toThrow(BadRequestException);
  });

  it('calls gateway.void and transitions AUTHORIZED -> VOIDED', async () => {
    const { service, gateway, getCurrent } = makeService({
      id: 'txn-1',
      status: PaymentStatus.AUTHORIZED,
      orderId: 'order-1',
      userId: 'user-1',
      gatewayReference: 'fake_txn-1',
    });

    await service.voidPayment('txn-1');

    expect(gateway.void).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 'txn-1', gatewayReference: 'fake_txn-1' }),
    );
    expect(getCurrent().status).toBe(PaymentStatus.VOIDED);
  });
});

describe('PaymentsService.simulateChargeback', () => {
  it('drives CAPTURED -> DISPUTED -> CHARGEBACK without touching the gateway', async () => {
    const { service, gateway, getCurrent } = makeService({
      id: 'txn-1',
      status: PaymentStatus.CAPTURED,
      orderId: 'order-1',
      userId: 'user-1',
      amountCents: 1000,
      currency: 'USD',
    });

    const result = await service.simulateChargeback('txn-1');

    expect(result.status).toBe(PaymentStatus.CHARGEBACK);
    expect(getCurrent().status).toBe(PaymentStatus.CHARGEBACK);
    expect(gateway.refund).not.toHaveBeenCalled();
    expect(gateway.void).not.toHaveBeenCalled();
  });

  it('rejects opening a dispute on a transaction that was never captured', async () => {
    const { service } = makeService({ id: 'txn-1', status: PaymentStatus.AUTHORIZED });
    await expect(service.simulateChargeback('txn-1')).rejects.toThrow(BadRequestException);
  });
});
