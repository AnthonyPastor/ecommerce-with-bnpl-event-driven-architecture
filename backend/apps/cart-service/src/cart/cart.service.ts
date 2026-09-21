import { PropagatingHttpService } from '@bnpl/observability';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
  private readonly orderServiceTimeoutMs: number;

  constructor(
    @InjectRepository(Cart) private readonly carts: Repository<Cart>,
    @InjectRepository(CartItem) private readonly cartItems: Repository<CartItem>,
    private readonly propagatingHttp: PropagatingHttpService,
    config: ConfigService,
  ) {
    this.orderServiceUrl = config.get<string>('ORDER_SERVICE_URL', 'http://localhost:3004');
    this.orderServiceTimeoutMs = Number(config.get('ORDER_SERVICE_TIMEOUT_MS', 10000));
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

  async updateItemQuantity(userId: string, itemId: string, quantity: number): Promise<CartDto> {
    const cart = await this.findOrCreateActiveCartEntity(userId);
    const item = cart.items.find((i) => i.id === itemId);
    if (!item) {
      throw new NotFoundException(`Item ${itemId} not found in ${userId}'s active cart`);
    }
    item.quantity = quantity;
    await this.cartItems.save(item);
    return this.toDto(cart);
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

  /**
   * Claims the cart atomically (`UPDATE ... WHERE status = 'ACTIVE'`) before
   * calling order-service, instead of flipping `status` only after that call
   * succeeds — two concurrent checkout calls for the same cart (double-click,
   * two tabs) would otherwise both pass the empty-cart check and both create
   * an order from the same items. Postgres serializes the two UPDATEs on the
   * row itself, so only one can ever match `status = 'ACTIVE'`; the loser
   * gets a 409 instead of a second order. On failure the claim is released
   * so the cart stays retryable with its original items, same as before.
   */
  async checkout(userId: string): Promise<unknown> {
    const cart = await this.findOrCreateActiveCartEntity(userId);
    if (cart.items.length === 0) {
      throw new BadRequestException('Cannot checkout an empty cart');
    }

    const claim = await this.carts.update({ id: cart.id, status: 'ACTIVE' }, { status: 'CHECKED_OUT' });
    if (claim.affected === 0) {
      throw new ConflictException(`Cart ${cart.id} was already checked out`);
    }

    try {
      const response = await firstValueFrom(
        this.propagatingHttp.post(
          `${this.orderServiceUrl}/orders`,
          {
            userId,
            items: cart.items.map((item) => ({
              productId: item.productId,
              variantId: item.variantId,
              name: item.name,
              unitPriceCents: item.unitPriceCents,
              quantity: item.quantity,
            })),
          },
          { timeout: this.orderServiceTimeoutMs },
        ),
      );
      return response.data;
    } catch (err) {
      await this.carts.update({ id: cart.id }, { status: 'ACTIVE' });
      throw err;
    }
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
