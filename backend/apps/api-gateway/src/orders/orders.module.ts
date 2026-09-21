import { Module } from '@nestjs/common';
import { ProxyModule } from '@gateway/proxy/proxy.module';
import { OrdersController } from './orders.controller';

@Module({
  imports: [ProxyModule],
  controllers: [OrdersController],
})
export class OrdersModule {}
