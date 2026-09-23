import { RequestContextModule } from '@bnpl/observability';
import { DynamicModule, Inject, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import * as amqplib from 'amqplib';
import { RabbitMqConsumerService } from './rabbitmq-consumer.service';
import { RabbitMqPublisherService } from './rabbitmq-publisher.service';
import { RABBITMQ_CHANNEL, RABBITMQ_CONNECTION } from './rabbitmq.constants';

export interface RabbitMqModuleOptions {
  url: string;
}

/** How long to wait for a graceful close before forcing the socket shut. */
const CLOSE_TIMEOUT_MS = 3000;

/**
 * Neither the channel nor the connection were ever closed on shutdown —
 * an open amqplib TCP socket keeps the Node event loop alive indefinitely,
 * so `app.close()` (and any e2e suite's `afterAll`) would hang forever
 * instead of exiting. Implementing `OnModuleDestroy` on the module class
 * itself (not a separate provider) lets it inject its own registered
 * RABBITMQ_CHANNEL/RABBITMQ_CONNECTION providers via constructor, same as
 * any other provider would.
 */
@Module({})
export class RabbitMqModule implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqModule.name);

  constructor(
    @Inject(RABBITMQ_CHANNEL) private readonly channel: amqplib.Channel,
    @Inject(RABBITMQ_CONNECTION) private readonly connection: amqplib.ChannelModel,
  ) {}

  /**
   * amqplib's `.close()` promisifies an AMQP close handshake (send
   * ConnectionClose, wait for ConnectionCloseOk) with NO built-in timeout —
   * if the broker never replies (e.g. the channel still has an in-flight
   * `consume()` callback processing a message when shutdown starts), the
   * promise never settles and the underlying socket is never released,
   * which is exactly what kept e2e runs hanging indefinitely after every
   * test had already passed. Bounding each close with a timeout, and
   * forcibly destroying the raw socket if the connection specifically
   * doesn't close in time, guarantees shutdown always completes — the same
   * safety a production graceful-shutdown path needs regardless of tests.
   */
  async onModuleDestroy(): Promise<void> {
    await this.closeWithTimeout(this.channel.close(), 'channel');
    await this.closeWithTimeout(this.connection.close(), 'connection', () => this.forceDestroySocket());
  }

  private async closeWithTimeout(pending: Promise<void>, label: string, onTimeout?: () => void): Promise<void> {
    let timedOut = false;
    const settleOrTimeout = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        resolve();
      }, CLOSE_TIMEOUT_MS);
      timer.unref?.();
      pending.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        () => {
          clearTimeout(timer);
          resolve();
        },
      );
    });
    await settleOrTimeout;
    if (timedOut) {
      this.logger.warn(
        `RabbitMQ ${label}.close() did not resolve within ${CLOSE_TIMEOUT_MS}ms, forcing shutdown to continue`,
      );
      onTimeout?.();
    }
  }

  /**
   * Last-resort fallback when the graceful close handshake hangs: reach
   * into amqplib's internal `Connection` (not exposed by its public types)
   * to destroy the raw socket directly, same as `toClosed()` does
   * internally on a normal close — this is what actually releases the
   * handle keeping the process alive.
   */
  private forceDestroySocket(): void {
    const raw = this.connection as unknown as { connection?: { stream?: { destroy(): void } } };
    raw.connection?.stream?.destroy();
  }

  static forRoot(options: RabbitMqModuleOptions): DynamicModule {
    return {
      module: RabbitMqModule,
      imports: [RequestContextModule],
      providers: [
        {
          provide: RABBITMQ_CONNECTION,
          useFactory: () => amqplib.connect(options.url),
        },
        {
          provide: RABBITMQ_CHANNEL,
          useFactory: async (connection: amqplib.ChannelModel) => connection.createChannel(),
          inject: [RABBITMQ_CONNECTION],
        },
        RabbitMqPublisherService,
        RabbitMqConsumerService,
      ],
      exports: [RabbitMqPublisherService, RabbitMqConsumerService, RABBITMQ_CHANNEL],
      global: true,
    };
  }
}
