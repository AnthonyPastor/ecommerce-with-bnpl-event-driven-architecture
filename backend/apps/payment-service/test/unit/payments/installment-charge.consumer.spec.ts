import { InstallmentChargeConsumer } from '../../../src/payments/installment-charge.consumer';

jest.mock('@bnpl/rabbitmq-client', () => ({
  ...jest.requireActual('@bnpl/rabbitmq-client'),
  bindRetryTopology: jest.fn(async () => undefined),
}));

type Handler = (command: unknown) => Promise<void>;

function makeConsumer() {
  let capturedHandler: Handler | undefined;
  const rabbitConsumer = {
    subscribe: jest.fn(async (_queue: string, handler: Handler) => {
      capturedHandler = handler;
    }),
  };
  const paymentsService = { chargeInstallment: jest.fn(async () => undefined) };

  const consumer = new InstallmentChargeConsumer({} as any, rabbitConsumer as any, paymentsService as any);
  return { consumer, paymentsService, getHandler: () => capturedHandler! };
}

const command = {
  installmentId: 'installment-1',
  planId: 'plan-1',
  orderId: 'order-1',
  userId: 'user-1',
  amountCents: 3333,
  currency: 'USD',
  attempt: 1,
};

describe('InstallmentChargeConsumer', () => {
  it('delegates a charge command to PaymentsService.chargeInstallment', async () => {
    const { consumer, paymentsService, getHandler } = makeConsumer();
    await consumer.onModuleInit();

    await getHandler()(command);

    expect(paymentsService.chargeInstallment).toHaveBeenCalledWith({
      installmentId: 'installment-1',
      orderId: 'order-1',
      userId: 'user-1',
      amountCents: 3333,
      currency: 'USD',
    });
  });
});
