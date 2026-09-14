import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DomainEventsToCommandsConsumer } from './domain-events-to-commands.consumer';
import { EmailCommandConsumer } from './email-command.consumer';
import { NotificationLog } from './entities/notification-log.entity';
import { NotificationsController } from './notifications.controller';
import { EMAIL_PROVIDER } from './ports/email-provider.port';
import { ConsoleEmailProvider } from './providers/console-email.provider';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationLog])],
  controllers: [NotificationsController],
  providers: [
    DomainEventsToCommandsConsumer,
    EmailCommandConsumer,
    ConsoleEmailProvider,
    {
      provide: EMAIL_PROVIDER,
      useFactory: (config: ConfigService, console_: ConsoleEmailProvider) => {
        const provider = config.get<string>('EMAIL_PROVIDER', 'console');
        switch (provider) {
          case 'console':
            return console_;
          default:
            throw new Error(`Unsupported EMAIL_PROVIDER "${provider}" — implement an EmailProviderPort adapter for it.`);
        }
      },
      inject: [ConfigService, ConsoleEmailProvider],
    },
  ],
})
export class NotificationsModule {}
