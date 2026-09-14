import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { BnplService } from './bnpl.service';

@Controller()
export class BnplController {
  constructor(private readonly bnplService: BnplService) {}

  @Get('installment-plans/:id')
  findById(@Param('id') id: string) {
    return this.bnplService.findPlanById(id);
  }

  @Get('installment-plans')
  find(@Query('orderId') orderId?: string, @Query('userId') userId?: string) {
    if (!orderId && !userId) {
      throw new BadRequestException('orderId or userId query param is required');
    }
    return this.bnplService.findPlans({ orderId, userId });
  }
}
