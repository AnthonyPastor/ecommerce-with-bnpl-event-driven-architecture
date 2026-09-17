import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  create(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.createPayment(dto);
  }

  /** `?orderId=` lets a client resolve "does this order already have a payment" without carrying a transactionId around. */
  @Get()
  findByOrderId(@Query('orderId') orderId: string) {
    return this.paymentsService.findByOrderId(orderId);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.paymentsService.findById(id);
  }

  /** Dev: triggers a refund (full or partial) against the configured gateway. */
  @Post(':id/refund')
  refund(@Param('id') id: string, @Body() dto: RefundPaymentDto) {
    return this.paymentsService.refundPayment(id, dto.amountCents);
  }

  /** Dev: cancels (voids) an authorized but not-yet-captured transaction. */
  @Post(':id/void')
  void(@Param('id') id: string) {
    return this.paymentsService.voidPayment(id);
  }

  /** Dev: simulates the card network notifying a chargeback. */
  @Post(':id/simulate-chargeback')
  simulateChargeback(@Param('id') id: string) {
    return this.paymentsService.simulateChargeback(id);
  }
}
