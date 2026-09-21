import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InstallmentPlan } from '../entities/installment-plan.entity';
import { UseCase } from './use-case.interface';

export interface ListInstallmentPlansFilter {
  orderId?: string;
  userId?: string;
}

@Injectable()
export class ListInstallmentPlansUseCase implements UseCase<ListInstallmentPlansFilter, InstallmentPlan[]> {
  constructor(@InjectRepository(InstallmentPlan) private readonly plans: Repository<InstallmentPlan>) {}

  async execute(filter: ListInstallmentPlansFilter): Promise<InstallmentPlan[]> {
    const where = filter.orderId ? { orderId: filter.orderId } : { userId: filter.userId };
    return this.plans.find({ where, relations: ['installments'], order: { createdAt: 'DESC' } });
  }
}
