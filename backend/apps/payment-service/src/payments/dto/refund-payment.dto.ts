import { IsInt, IsOptional, IsPositive } from 'class-validator';

export class RefundPaymentDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  amountCents?: number;
}
