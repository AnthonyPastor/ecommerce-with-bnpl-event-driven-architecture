import { Injectable, Logger } from '@nestjs/common';
import { EmailProviderPort, SendEmailInput } from '@notification/notifications/ports/email-provider.port';

@Injectable()
export class ConsoleEmailProvider extends EmailProviderPort {
  private readonly logger = new Logger(ConsoleEmailProvider.name);

  async send(input: SendEmailInput): Promise<void> {
    this.logger.log(`[EMAIL:${input.template}] to=${input.to} data=${JSON.stringify(input.data)}`);
  }
}
