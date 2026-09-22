import { InstallmentStatus } from '@bnpl/event-contracts';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, LessThanOrEqual } from 'typeorm';
import { ChargeDueInstallmentUseCase } from './charge-due-installment.use-case';
import { Installment } from '../entities/installment.entity';
import { UseCase } from './use-case.interface';

const BATCH_SIZE = 50;

/**
 * Finds installments due for a charge and hands each one to
 * `ChargeDueInstallmentUseCase`. A plain unlocked read — no reason to lock
 * here, since each installment gets its own row lock inside that use case;
 * this query only needs a consistent-enough snapshot to build the candidate
 * list, not a guarantee nobody else touches these rows in between.
 */
@Injectable()
export class PollDueInstallmentsUseCase implements UseCase<void, void> {
  private readonly logger = new Logger(PollDueInstallmentsUseCase.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly chargeDueInstallment: ChargeDueInstallmentUseCase,
  ) {}

  async execute(): Promise<void> {
    const due = await this.dataSource.manager.find(Installment, {
      where: {
        status: In([InstallmentStatus.PENDING, InstallmentStatus.DUE]),
        dueDate: LessThanOrEqual(new Date()),
      },
      order: { dueDate: 'ASC' },
      take: BATCH_SIZE,
    });

    if (due.length === 0) {
      return;
    }
    this.logger.log(`Found ${due.length} due installment(s) to charge`);

    for (const installment of due) {
      try {
        await this.chargeDueInstallment.execute({ installmentId: installment.id });
      } catch (err) {
        // One installment's failure shouldn't stop the rest of the batch —
        // it'll be picked up again on the next poll tick.
        this.logger.error(`Failed to process due installment ${installment.id}: ${(err as Error).message}`);
      }
    }
  }
}
