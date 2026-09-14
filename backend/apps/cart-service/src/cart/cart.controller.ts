import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { AddItemDto } from './dto/add-item.dto';
import { CartService } from './cart.service';
import { CheckoutDto } from './dto/checkout.dto';

@Controller()
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get('cart')
  getCart(@Query('userId') userId: string) {
    return this.cartService.getOrCreateActiveCart(userId);
  }

  @Post('cart/items')
  addItem(@Body() dto: AddItemDto) {
    return this.cartService.addItem(dto);
  }

  @Delete('cart/items/:itemId')
  removeItem(@Param('itemId') itemId: string, @Query('userId') userId: string) {
    return this.cartService.removeItem(userId, itemId);
  }

  @Post('cart/checkout')
  checkout(@Body() dto: CheckoutDto) {
    return this.cartService.checkout(dto.userId);
  }
}
