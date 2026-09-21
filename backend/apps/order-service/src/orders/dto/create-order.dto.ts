import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateOrderItemDto {
  @IsString()
  @MinLength(1)
  productId!: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsInt()
  @IsPositive()
  unitPriceCents!: number;

  @IsInt()
  @IsPositive()
  quantity!: number;
}

export class CreateOrderDto {
  @IsString()
  @MinLength(1)
  userId!: string;

  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  @ArrayMinSize(1)
  items!: CreateOrderItemDto[];

  /**
   * Caller-supplied dedupe key (cart-service sends `cart.id`) — a retry of
   * the same checkout after a timed-out/dropped response returns the
   * already-created order instead of creating a second one.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  idempotencyKey?: string;
}
