import { Body, Controller, Get, Param, Post } from '@nestjs/common';
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

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.paymentsService.findById(id);
  }

  /** Dev: dispara un refund (total u parcial) contra el gateway configurado. */
  @Post(':id/refund')
  refund(@Param('id') id: string, @Body() dto: RefundPaymentDto) {
    return this.paymentsService.refundPayment(id, dto.amountCents);
  }

  /** Dev: cancela (void) una transacción autorizada pero no capturada. */
  @Post(':id/void')
  void(@Param('id') id: string) {
    return this.paymentsService.voidPayment(id);
  }

  /** Dev: simula que la red de tarjetas notificó un chargeback. */
  @Post(':id/simulate-chargeback')
  simulateChargeback(@Param('id') id: string) {
    return this.paymentsService.simulateChargeback(id);
  }
}
