import { RabbitMqModule } from '../../src/rabbitmq.module';

describe('RabbitMqModule.onModuleDestroy', () => {
  it('closes both the channel and the connection', async () => {
    const channel = { close: jest.fn(async () => undefined) };
    const connection = { close: jest.fn(async () => undefined) };
    const module = new RabbitMqModule(channel as any, connection as any);

    await module.onModuleDestroy();

    expect(channel.close).toHaveBeenCalled();
    expect(connection.close).toHaveBeenCalled();
  });

  it('still closes the connection even if closing the channel fails', async () => {
    const channel = { close: jest.fn(async () => { throw new Error('already closed'); }) };
    const connection = { close: jest.fn(async () => undefined) };
    const module = new RabbitMqModule(channel as any, connection as any);

    await expect(module.onModuleDestroy()).resolves.toBeUndefined();

    expect(connection.close).toHaveBeenCalled();
  });
});
