import { Module } from '@nestjs/common';
import { ProxyModule } from '@gateway/proxy/proxy.module';
import { NotificationsController } from './notifications.controller';

@Module({
  imports: [ProxyModule],
  controllers: [NotificationsController],
})
export class NotificationsModule {}
