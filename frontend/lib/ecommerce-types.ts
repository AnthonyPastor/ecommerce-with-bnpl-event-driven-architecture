export interface Category {
  id: string;
  name: string;
  slug: string;
}

export interface ProductVariant {
  id: string;
  name: string;
  priceCents: number;
  stock: number;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  imageUrl: string | null;
  isPro: boolean;
  category: Category | null;
  variants: ProductVariant[];
}

export interface PaginatedProducts {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface CartItem {
  id: string;
  productId: string;
  variantId: string | null;
  name: string;
  unitPriceCents: number;
  quantity: number;
}

export interface Cart {
  id: string;
  userId: string;
  status: 'ACTIVE' | 'CHECKED_OUT';
  items: CartItem[];
  totalCents: number;
}

export interface OrderItem {
  id: string;
  productId: string;
  variantId: string | null;
  name: string;
  unitPriceCents: number;
  quantity: number;
}

export interface Order {
  id: string;
  userId: string;
  status: 'CREATED' | 'CONFIRMED' | 'CANCELLED' | 'REFUNDED';
  /** Computed server-side by order-service from status + paymentMethod + paymentIncident. */
  paymentStatus: 'UNPAID' | 'PAID' | 'INSTALLMENTS_PENDING' | 'PARTIALLY_REFUNDED' | 'DISPUTED' | 'CHARGEBACK';
  totalCents: number;
  currency: string;
  items: OrderItem[];
  createdAt: string;
  updatedAt: string;
}
