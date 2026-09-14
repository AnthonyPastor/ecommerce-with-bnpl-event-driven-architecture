import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Cart } from './cart.entity';

@Entity('cart_items')
export class CartItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Cart, (cart) => cart.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cart_id' })
  cart!: Cart;

  @Column({ name: 'cart_id' })
  cartId!: string;

  @Column({ name: 'product_id' })
  productId!: string;

  @Column({ name: 'variant_id', type: 'varchar', nullable: true })
  variantId!: string | null;

  @Column()
  name!: string;

  @Column({ name: 'unit_price_cents', type: 'int' })
  unitPriceCents!: number;

  @Column({ type: 'int', default: 1 })
  quantity!: number;
}
