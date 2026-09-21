import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InstallmentPlan } from '../entities/installment-plan.entity';
import { UseCase } from './use-case.interface';

@Injectable()
export class GetInstallmentPlanUseCase implements UseCase<string, InstallmentPlan> {
  constructor(@InjectRepository(InstallmentPlan) private readonly plans: Repository<InstallmentPlan>) {}

  async execute(id: string): Promise<InstallmentPlan> {
    const plan = await this.plans.findOne({ where: { id }, relations: ['installments'] });
    if (!plan) {
      throw new NotFoundException(`Installment plan ${id} not found`);
    }
    return plan;
  }
}
