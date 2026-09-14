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
   * Crea la Order + sus items + el evento `order.order.created.v1` en la
   * MISMA transacción SQL (patrón outbox) — o se guarda todo, o nada.
   * El `transactionId` de negocio nace acá (= order.id) y viaja en el
   * evento para que todo lo que reaccione a esta orden (payment-service,
   * bnpl-service) comparta el mismo id de principio a fin.
   */
  async createOrder(dto: CreateOrderDto): Promise<Order> {
    const totalCents = dto.items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Generamos el id nosotros (en vez de dejar que lo asigne el DEFAULT de
      // Postgres) porque lo necesitamos ANTES del save para usarlo como
      // aggregateId/transactionId del evento de outbox en la misma llamada.
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

      // El transactionId de negocio recién nace acá (order.id) — lo dejamos
      // en el contexto para que el resto del request (logs, response) lo tenga.
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

  /** Reacción a `payment.transaction.refunded.v1` (refund total): marca la orden como reembolsada. */
  async markRefunded(orderId: string): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const order = await queryRunner.manager.findOneOrFail(Order, { where: { id: orderId } });
      if (order.status === OrderStatus.REFUNDED) {
        await queryRunner.rollbackTransaction();
        return; // idempotente: ya procesado
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
