import { IsInt, IsOptional, IsPositive, IsString, Min } from 'class-validator';

export class AddItemDto {
  @IsString()
  userId!: string;

  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsString()
  name!: string;

  @IsInt()
  @Min(0)
  unitPriceCents!: number;

  @IsInt()
  @IsPositive()
  quantity!: number;
}
