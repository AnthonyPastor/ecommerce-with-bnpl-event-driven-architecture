import { IsInt, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

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
}
