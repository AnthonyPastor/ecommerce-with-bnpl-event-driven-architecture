import { PropagatingHttpService } from '@bnpl/observability';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { firstValueFrom } from 'rxjs';
import { Repository } from 'typeorm';
import { AddItemDto } from './dto/add-item.dto';
import { CartDto } from './dto/cart.dto';
import { CartItem } from './entities/cart-item.entity';
import { Cart } from './entities/cart.entity';

@Injectable()
export class CartService {
  private readonly orderServiceUrl: string;

  constructor(
    @InjectRepository(Cart) private readonly carts: Repository<Cart>,
    @InjectRepository(CartItem) private readonly cartItems: Repository<CartItem>,
    private readonly propagatingHttp: PropagatingHttpService,
    config: ConfigService,
  ) {
    this.orderServiceUrl = config.get<string>('ORDER_SERVICE_URL', 'http://localhost:3004');
  }

  async getOrCreateActiveCart(userId: string): Promise<CartDto> {
    const cart = await this.findOrCreateActiveCartEntity(userId);
    return this.toDto(cart);
  }

  async addItem(dto: AddItemDto): Promise<CartDto> {
    const cart = await this.findOrCreateActiveCartEntity(dto.userId);

    const existing = cart.items.find(
      (item) => item.productId === dto.productId && item.variantId === (dto.variantId ?? null),
    );

    if (existing) {
      existing.quantity += dto.quantity;
      await this.cartItems.save(existing);
    } else {
      const item = this.cartItems.create({
        cartId: cart.id,
        productId: dto.productId,
        variantId: dto.variantId ?? null,
        name: dto.name,
        unitPriceCents: dto.unitPriceCents,
        quantity: dto.quantity,
      });
      await this.cartItems.save(item);
    }

    return this.getOrCreateActiveCart(dto.userId);
  }

  async removeItem(userId: string, itemId: string): Promise<CartDto> {
    const cart = await this.findOrCreateActiveCartEntity(userId);
    const item = cart.items.find((i) => i.id === itemId);
    if (!item) {
      throw new NotFoundException(`Item ${itemId} not found in ${userId}'s active cart`);
    }
    await this.cartItems.remove(item);
    return this.getOrCreateActiveCart(userId);
  }

  async checkout(userId: string): Promise<unknown> {
    const cart = await this.findOrCreateActiveCartEntity(userId);
    if (cart.items.length === 0) {
      throw new BadRequestException('Cannot checkout an empty cart');
    }

    const response = await firstValueFrom(
      this.propagatingHttp.post(`${this.orderServiceUrl}/orders`, {
        userId,
        items: cart.items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          name: item.name,
          unitPriceCents: item.unitPriceCents,
          quantity: item.quantity,
        })),
      }),
    );

    cart.status = 'CHECKED_OUT';
    await this.carts.save(cart);

    return response.data;
  }

  private async findOrCreateActiveCartEntity(userId: string): Promise<Cart> {
    let cart = await this.carts.findOne({
      where: { userId, status: 'ACTIVE' },
      relations: { items: true },
    });

    if (!cart) {
      cart = await this.carts.save(this.carts.create({ userId, status: 'ACTIVE' }));
      cart.items = [];
    }

    return cart;
  }

  private toDto(cart: Cart): CartDto {
    const items = cart.items ?? [];
    return {
      id: cart.id,
      userId: cart.userId,
      status: cart.status,
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        variantId: item.variantId,
        name: item.name,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
      })),
      totalCents: items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0),
    };
  }
}
