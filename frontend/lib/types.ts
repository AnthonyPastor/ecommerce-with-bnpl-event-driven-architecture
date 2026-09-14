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
  categoryId: string;
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
  totalCents: number;
  currency: string;
  items: OrderItem[];
  createdAt: string;
  updatedAt: string;
}

export type PaymentStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'AUTHORIZATION_FAILED'
  | 'CAPTURED'
  | 'CAPTURE_FAILED'
  | 'VOIDED'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED'
  | 'DISPUTED'
  | 'CHARGEBACK'
  | 'CANCELLED';

export interface Transaction {
  id: string;
  orderId: string;
  userId: string;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  gatewayProvider: string;
  gatewayReference: string | null;
  createdAt: string;
  updatedAt: string;
}

export type InstallmentStatus = 'PENDING' | 'DUE' | 'PAID' | 'OVERDUE' | 'DEFAULTED' | 'CANCELLED';

export interface Installment {
  id: string;
  installmentNumber: number;
  amountCents: number;
  dueDate: string;
  status: InstallmentStatus;
}

export type InstallmentPlanStatus = 'PENDING' | 'ACTIVE' | 'ADJUSTED' | 'CANCELLED' | 'DISPUTED_HOLD';

export interface InstallmentPlan {
  id: string;
  orderId: string;
  userId: string;
  totalCents: number;
  currency: string;
  installmentsCount: number;
  status: InstallmentPlanStatus;
  installments: Installment[];
}
