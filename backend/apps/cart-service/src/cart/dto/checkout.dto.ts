import { IsString } from 'class-validator';

export class CheckoutDto {
  @IsString()
  userId!: string;
}
