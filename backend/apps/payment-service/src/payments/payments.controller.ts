import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
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

  /**
   * `?orderId=` lets a client resolve "does this order already have a payment"
   * without carrying a transactionId around. Scoped to the caller via `x-user-id`
   * (set by `GatewayAuthGuard` from the verified JWT before this request ever
   * reaches this service) so one user can't read another user's transactions
   * by guessing/enumerating orderIds.
   */
  @Get()
  findByOrderId(@Query('orderId') orderId?: string, @Headers('x-user-id') userId?: string) {
    if (!orderId) {
      throw new BadRequestException('orderId query param is required');
    }
    if (!userId) {
      throw new UnauthorizedException('x-user-id header is required');
    }
    return this.paymentsService.findByOrderId(orderId, userId);
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

  /** Dev: simulates the card network resolving an open dispute in the merchant's favor. */
  @Post(':id/resolve-dispute')
  resolveDispute(@Param('id') id: string) {
    return this.paymentsService.resolveDispute(id);
  }
}
