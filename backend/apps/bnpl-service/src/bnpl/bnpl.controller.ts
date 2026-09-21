import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { GetInstallmentPlanUseCase } from './use-cases/get-installment-plan.use-case';
import { ListInstallmentPlansUseCase } from './use-cases/list-installment-plans.use-case';

@Controller()
export class BnplController {
  constructor(
    private readonly getInstallmentPlan: GetInstallmentPlanUseCase,
    private readonly listInstallmentPlans: ListInstallmentPlansUseCase,
  ) {}

  @Get('installment-plans/:id')
  findById(@Param('id') id: string) {
    return this.getInstallmentPlan.execute(id);
  }

  @Get('installment-plans')
  find(@Query('orderId') orderId?: string, @Query('userId') userId?: string) {
    if (!orderId && !userId) {
      throw new BadRequestException('orderId or userId query param is required');
    }
    return this.listInstallmentPlans.execute({ orderId, userId });
  }
}
