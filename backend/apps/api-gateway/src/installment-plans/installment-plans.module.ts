import { Module } from '@nestjs/common';
import { ProxyModule } from '../proxy/proxy.module';
import { InstallmentPlansController } from './installment-plans.controller';

@Module({
  imports: [ProxyModule],
  controllers: [InstallmentPlansController],
})
export class InstallmentPlansModule {}
