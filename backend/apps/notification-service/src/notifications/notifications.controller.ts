import { Controller, Get, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationLog } from './entities/notification-log.entity';

@Controller('notifications')
export class NotificationsController {
  constructor(@InjectRepository(NotificationLog) private readonly logs: Repository<NotificationLog>) {}

  @Get()
  find(@Query('to') to?: string) {
    return this.logs.find({
      where: to ? { to } : {},
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }
}
