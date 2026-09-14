import { OutboxModule } from '@bnpl/outbox';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderItem } from './entities/order-item.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { Order } from './entities/order.entity';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PaymentEventsConsumer } from './payment-events.consumer';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, OrderStatusHistory]),
    OutboxModule.forFeature({ producerName: 'order-service' }),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, PaymentEventsConsumer],
})
export class OrdersModule {}
