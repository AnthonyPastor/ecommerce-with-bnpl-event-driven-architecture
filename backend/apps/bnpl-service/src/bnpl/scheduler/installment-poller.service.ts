import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PollDueInstallmentsUseCase } from '../use-cases/poll-due-installments.use-case';

/**
 * First scheduled/polling job in this codebase — every other async flow
 * here is reactive (Kafka/RabbitMQ consumer), since a due date is the one
 * thing nothing publishes an event for on its own. Just delegates; the
 * actual logic lives in `PollDueInstallmentsUseCase` so it's testable
 * without `@nestjs/schedule` in the loop.
 */
@Injectable()
export class InstallmentPollerService {
  private readonly logger = new Logger(InstallmentPollerService.name);

  constructor(private readonly pollDueInstallments: PollDueInstallmentsUseCase) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    try {
      await this.pollDueInstallments.execute();
    } catch (err) {
      this.logger.error(`Installment poll tick failed: ${(err as Error).message}`);
    }
  }
}
