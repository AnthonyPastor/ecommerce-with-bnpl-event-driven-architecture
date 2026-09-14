import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { CartService } from './cart.service';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';

function makeRepoMock<T extends { id?: string }>() {
  const rows: T[] = [];
  return {
    rows,
    findOne: jest.fn(async ({ where }: any) => {
      return (
        rows.find((r: any) => {
          if (where.id !== undefined && r.id !== where.id) return false;
          if (where.userId !== undefined && r.userId !== where.userId) return false;
          if (where.status !== undefined && r.status !== where.status) return false;
          return true;
        }) ?? null
      );
    }),
    create: jest.fn((data: any) => ({ id: `id-${rows.length + 1}`, ...data })),
    save: jest.fn(async (entity: any) => {
      const idx = rows.findIndex((r: any) => r.id === entity.id);
      if (idx >= 0) rows[idx] = entity;
      else rows.push(entity);
      return entity;
    }),
    remove: jest.fn(async (entity: any) => {
      const idx = rows.findIndex((r: any) => r.id === entity.id);
      if (idx >= 0) rows.splice(idx, 1);
      return entity;
    }),
  };
}

describe('CartService', () => {
  let carts: ReturnType<typeof makeRepoMock<Cart>>;
  let cartItems: ReturnType<typeof makeRepoMock<CartItem>>;
  let propagatingHttp: { post: jest.Mock };
  let service: CartService;

  beforeEach(() => {
    carts = makeRepoMock<Cart>();
    cartItems = makeRepoMock<CartItem>();
    propagatingHttp = { post: jest.fn() };
    const config = new ConfigService({ ORDER_SERVICE_URL: 'http://order-service.test' });

    // El repo real de items vive embebido en cart.items para simplificar el mock.
    (carts as any).findOne = jest.fn(async ({ where }: any) => {
      const cart = carts.rows.find(
        (r: any) => r.userId === where.userId && r.status === where.status,
      );
      if (!cart) return null;
      return { ...cart, items: cartItems.rows.filter((i: any) => i.cartId === cart.id) };
    });

    service = new CartService(carts as any, cartItems as any, propagatingHttp as any, config);
  });

  it('creates an empty ACTIVE cart on first access', async () => {
    const dto = await service.getOrCreateActiveCart('user-1');
    expect(dto).toMatchObject({ userId: 'user-1', status: 'ACTIVE', items: [], totalCents: 0 });
  });

  it('adds a new item to the cart', async () => {
    const dto = await service.addItem({
      userId: 'user-1',
      productId: 'prod-1',
      name: 'Widget',
      unitPriceCents: 1000,
      quantity: 2,
    });
    expect(dto.items).toHaveLength(1);
    expect(dto.items[0]).toMatchObject({ productId: 'prod-1', quantity: 2, unitPriceCents: 1000 });
    expect(dto.totalCents).toBe(2000);
  });

  it('increments quantity when the same productId+variantId is added again', async () => {
    await service.addItem({
      userId: 'user-1',
      productId: 'prod-1',
      name: 'Widget',
      unitPriceCents: 1000,
      quantity: 1,
    });
    const dto = await service.addItem({
      userId: 'user-1',
      productId: 'prod-1',
      name: 'Widget',
      unitPriceCents: 1000,
      quantity: 3,
    });
    expect(dto.items).toHaveLength(1);
    expect(dto.items[0].quantity).toBe(4);
  });

  it('removes an item from the cart', async () => {
    const afterAdd = await service.addItem({
      userId: 'user-1',
      productId: 'prod-1',
      name: 'Widget',
      unitPriceCents: 1000,
      quantity: 1,
    });
    const itemId = afterAdd.items[0].id;

    const afterRemove = await service.removeItem('user-1', itemId);
    expect(afterRemove.items).toHaveLength(0);
  });

  it('removeItem throws NotFoundException for an unknown item', async () => {
    await service.getOrCreateActiveCart('user-1');
    await expect(service.removeItem('user-1', 'nonexistent')).rejects.toThrow(NotFoundException);
  });

  it('checkout throws BadRequestException on an empty cart', async () => {
    await service.getOrCreateActiveCart('user-1');
    await expect(service.checkout('user-1')).rejects.toThrow(BadRequestException);
  });

  it('checkout posts to order-service and marks the cart CHECKED_OUT', async () => {
    await service.addItem({
      userId: 'user-1',
      productId: 'prod-1',
      variantId: 'var-1',
      name: 'Widget',
      unitPriceCents: 1000,
      quantity: 2,
    });

    propagatingHttp.post.mockReturnValue(of({ data: { id: 'order-1', status: 'CREATED' } }));

    const result = await service.checkout('user-1');

    expect(propagatingHttp.post).toHaveBeenCalledWith('http://order-service.test/orders', {
      userId: 'user-1',
      items: [
        {
          productId: 'prod-1',
          variantId: 'var-1',
          name: 'Widget',
          unitPriceCents: 1000,
          quantity: 2,
        },
      ],
    });
    expect(result).toEqual({ id: 'order-1', status: 'CREATED' });

    const cartRow = carts.rows.find((r: any) => r.userId === 'user-1');
    expect(cartRow?.status).toBe('CHECKED_OUT');
  });
});
