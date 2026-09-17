import { PaymentMethod } from '@bnpl/event-contracts';
import { IsEnum, IsInt, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

export class CreatePaymentDto {
  @IsString()
  @MinLength(1)
  orderId!: string;

  @IsString()
  @MinLength(1)
  userId!: string;

  @IsInt()
  @IsPositive()
  amountCents!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  /** Defaults to INSTALLMENTS when omitted, preserving pre-existing behavior. */
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;
}
