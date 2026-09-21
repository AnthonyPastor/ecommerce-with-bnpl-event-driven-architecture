import { randomUUID } from 'node:crypto';
import { KafkaTopics, OrderStatus, PaymentMethod } from '@bnpl/event-contracts';
import { RequestContextService } from '@bnpl/observability';
import { saveWithOutbox } from '@bnpl/outbox';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderItem } from './entities/order-item.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { Order } from './entities/order.entity';

/**
 * What the client actually cares about: did this order get paid, and how.
 * Computed here (not stored) so it's always derived from `status` +
 * `paymentMethod` + `paymentIncident` rather than risking them drifting apart.
 * `INSTALLMENTS_PENDING` is honest about a known gap: no installment is ever
 * actually marked PAID yet (no "charge the next installment" job exists), so
 * an installments order never legitimately reaches a "paid off" state today.
 * `PARTIALLY_REFUNDED`/`DISPUTED`/`CHARGEBACK` reflect payment-service's own
 * post-capture states (see `payment-events.consumer.ts`) and take priority
 * over the CONFIRMED-derived PAID/INSTALLMENTS_PENDING split — the order
 * lifecycle `status` alone can't capture those, since payment state keeps
 * moving after CONFIRMED.
 */
export type OrderPaymentStatus =
  | 'UNPAID'
  | 'PAID'
  | 'INSTALLMENTS_PENDING'
  | 'PARTIALLY_REFUNDED'
  | 'DISPUTED'
  | 'CHARGEBACK';

export type OrderWithPaymentStatus = Order & { paymentStatus: OrderPaymentStatus };

function paymentStatusFor(order: Order): OrderPaymentStatus {
  if (order.paymentIncident) {
    return order.paymentIncident;
  }
  if (order.status !== OrderStatus.CONFIRMED) {
    return 'UNPAID';
  }
  return order.paymentMethod === PaymentMethod.FULL ? 'PAID' : 'INSTALLMENTS_PENDING';
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly requestContext: RequestContextService,
  ) {}

  /**
   * Creates the Order + its items + the `order.order.created.v1` event in the
   * SAME SQL transaction (outbox pattern) — either everything is saved, or
   * nothing is. The business `transactionId` is born here (= order.id) and
   * travels in the event so that everything reacting to this order
   * (payment-service, bnpl-service) shares the same id end to end.
   *
   * When `dto.idempotencyKey` is given, a retry (e.g. cart-service re-sending
   * after a client-side timeout whose response it never saw) returns the
   * already-created order instead of creating a duplicate. Guarded by a
   * Postgres advisory lock keyed on `idempotencyKey`, same pattern as
   * `PaymentsService.createPayment()` — a plain row lock can't help on the
   * very first call, since there's no row yet to lock.
   */
  async createOrder(dto: CreateOrderDto): Promise<Order> {
    const totalCents = dto.items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (dto.idempotencyKey) {
        await queryRunner.query('SELECT pg_advisory_xact_lock(hashtext($1))', [dto.idempotencyKey]);
        const existing = await queryRunner.manager.findOne(Order, {
          where: { idempotencyKey: dto.idempotencyKey },
          relations: ['items'],
        });
        if (existing) {
          await queryRunner.commitTransaction();
          this.requestContext.setTransactionId(existing.id);
          return existing;
        }
      }

      // We generate the id ourselves (instead of letting Postgres' DEFAULT
      // assign it) because we need it BEFORE the save to use it as the
      // aggregateId/transactionId of the outbox event in the same call.
      const order = queryRunner.manager.create(Order, {
        id: randomUUID(),
        userId: dto.userId,
        status: OrderStatus.CREATED,
        totalCents,
        currency: 'USD',
        idempotencyKey: dto.idempotencyKey ?? null,
        items: dto.items.map((item) =>
          queryRunner.manager.create(OrderItem, {
            productId: item.productId,
            variantId: item.variantId ?? null,
            name: item.name,
            unitPriceCents: item.unitPriceCents,
            quantity: item.quantity,
          }),
        ),
      });

      const correlationId = this.requestContext.getCorrelationId() ?? 'unknown';

      const savedOrder = await saveWithOutbox(queryRunner, order, {
        eventType: KafkaTopics.order.created,
        aggregateType: 'Order',
        aggregateId: order.id,
        correlationId,
        transactionId: order.id,
        payload: {
          orderId: order.id,
          userId: order.userId,
          totalCents: order.totalCents,
          currency: order.currency,
          items: dto.items,
        },
      });

      const history = queryRunner.manager.create(OrderStatusHistory, {
        order: savedOrder,
        fromStatus: null,
        toStatus: OrderStatus.CREATED,
      });
      await queryRunner.manager.save(history);

      await queryRunner.commitTransaction();

      // The business transactionId is only born here (order.id) — we set it
      // on the context so the rest of the request (logs, response) has it.
      this.requestContext.setTransactionId(savedOrder.id);

      return savedOrder;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async findById(id: string): Promise<OrderWithPaymentStatus> {
    const order = await this.orders.findOne({ where: { id }, relations: ['items'] });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return { ...order, paymentStatus: paymentStatusFor(order) };
  }

  async findByUserId(userId: string): Promise<OrderWithPaymentStatus[]> {
    const orders = await this.orders.find({ where: { userId }, relations: ['items'], order: { createdAt: 'DESC' } });
    return orders.map((order) => ({ ...order, paymentStatus: paymentStatusFor(order) }));
  }

  /**
   * Reaction to `payment.transaction.captured.v1`: marks the order as confirmed
   * once its payment succeeds. Kafka delivery is at-least-once, so a duplicate
   * delivery for the same order can race a prior one still mid-transaction —
   * `pessimistic_write` takes a row lock on the SELECT so a concurrent call
   * blocks until the first commits, then sees the already-CONFIRMED status and
   * takes the idempotent no-op path below instead of double-confirming.
   */
  async markConfirmed(orderId: string, paymentMethod: PaymentMethod | null): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const order = await queryRunner.manager.findOneOrFail(Order, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (order.status !== OrderStatus.CREATED) {
        await queryRunner.rollbackTransaction();
        return; // idempotent: already confirmed, or moved past CREATED some other way
      }

      const fromStatus = order.status;
      order.status = OrderStatus.CONFIRMED;
      order.paymentMethod = paymentMethod;

      const saved = await saveWithOutbox(queryRunner, order, {
        eventType: KafkaTopics.order.confirmed,
        aggregateType: 'Order',
        aggregateId: order.id,
        correlationId: this.requestContext.getCorrelationId() ?? 'unknown',
        transactionId: order.id,
        payload: { orderId: order.id, userId: order.userId },
      });

      const history = queryRunner.manager.create(OrderStatusHistory, {
        order: saved,
        fromStatus,
        toStatus: OrderStatus.CONFIRMED,
      });
      await queryRunner.manager.save(history);

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /** Reaction to `payment.transaction.refunded.v1` (full refund): marks the order as refunded. */
  async markRefunded(orderId: string): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const order = await queryRunner.manager.findOneOrFail(Order, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (order.status === OrderStatus.REFUNDED) {
        await queryRunner.rollbackTransaction();
        return; // idempotent: already processed
      }

      const fromStatus = order.status;
      order.status = OrderStatus.REFUNDED;
      order.paymentIncident = null; // a full refund supersedes any prior dispute/chargeback/partial-refund signal

      const saved = await saveWithOutbox(queryRunner, order, {
        eventType: KafkaTopics.order.refunded,
        aggregateType: 'Order',
        aggregateId: order.id,
        correlationId: this.requestContext.getCorrelationId() ?? 'unknown',
        transactionId: order.id,
        payload: { orderId: order.id, userId: order.userId },
      });

      const history = queryRunner.manager.create(OrderStatusHistory, {
        order: saved,
        fromStatus,
        toStatus: OrderStatus.REFUNDED,
      });
      await queryRunner.manager.save(history);

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Reaction to `payment.transaction.partially_refunded.v1` / `.dispute_opened.v1`
   * / `.chargeback_received.v1`: mirrors the payment health signal onto the
   * order so the computed `paymentStatus` reflects it. This isn't itself an
   * outbox/domain event — nothing else reacts to order-service's copy of this
   * signal, only to payment-service's own topics (see that service's CLAUDE.md) —
   * so a plain idempotent update is enough, no transactional outbox needed.
   */
  async markPaymentIncident(
    orderId: string,
    incident: 'PARTIALLY_REFUNDED' | 'DISPUTED' | 'CHARGEBACK',
  ): Promise<void> {
    const result = await this.orders.update({ id: orderId }, { paymentIncident: incident });
    if (result.affected === 0) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
  }
}
