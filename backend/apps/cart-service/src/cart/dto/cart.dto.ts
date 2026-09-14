export interface CartItemDto {
  id: string;
  productId: string;
  variantId: string | null;
  name: string;
  unitPriceCents: number;
  quantity: number;
}

export interface CartDto {
  id: string;
  userId: string;
  status: string;
  items: CartItemDto[];
  totalCents: number;
}
