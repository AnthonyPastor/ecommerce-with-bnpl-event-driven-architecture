import { Module } from '@nestjs/common';
import { ProxyModule } from '@gateway/proxy/proxy.module';
import { PaymentsController } from './payments.controller';

@Module({
  imports: [ProxyModule],
  controllers: [PaymentsController],
})
export class PaymentsModule {}
