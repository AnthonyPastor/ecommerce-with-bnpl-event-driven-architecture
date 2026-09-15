import { Module } from '@nestjs/common';
import { ProxyModule } from '../proxy/proxy.module';
import { CartController } from './cart.controller';

@Module({
  imports: [ProxyModule],
  controllers: [CartController],
})
export class CartModule {}
