import { randomUUID } from 'node:crypto';
import { KafkaTopics, OrderStatus } from '@bnpl/event-contracts';
import { RequestContextService } from '@bnpl/observability';
import { saveWithOutbox } from '@bnpl/outbox';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderItem } from './entities/order-item.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { Order } from './entities/order.entity';

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
   */
  async createOrder(dto: CreateOrderDto): Promise<Order> {
    const totalCents = dto.items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // We generate the id ourselves (instead of letting Postgres' DEFAULT
      // assign it) because we need it BEFORE the save to use it as the
      // aggregateId/transactionId of the outbox event in the same call.
      const order = queryRunner.manager.create(Order, {
        id: randomUUID(),
        userId: dto.userId,
        status: OrderStatus.CREATED,
        totalCents,
        currency: 'USD',
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

  async findById(id: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id }, relations: ['items'] });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }

  async findByUserId(userId: string): Promise<Order[]> {
    return this.orders.find({ where: { userId }, relations: ['items'], order: { createdAt: 'DESC' } });
  }

  /** Reaction to `payment.transaction.refunded.v1` (full refund): marks the order as refunded. */
  async markRefunded(orderId: string): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const order = await queryRunner.manager.findOneOrFail(Order, { where: { id: orderId } });
      if (order.status === OrderStatus.REFUNDED) {
        await queryRunner.rollbackTransaction();
        return; // idempotent: already processed
      }

      const fromStatus = order.status;
      order.status = OrderStatus.REFUNDED;

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
}
