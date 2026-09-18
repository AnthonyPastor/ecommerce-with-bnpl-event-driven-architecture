import { Module } from '@nestjs/common';
import { ProxyModule } from '@gateway/proxy/proxy.module';
import { InstallmentPlansController } from './installment-plans.controller';

@Module({
  imports: [ProxyModule],
  controllers: [InstallmentPlansController],
})
export class InstallmentPlansModule {}
