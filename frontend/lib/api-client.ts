import { useAuthStore } from '../store/auth-store';
import type {
  AuthTokens,
  AuthUser,
  Cart,
  Category,
  InstallmentPlan,
  Order,
  PaginatedProducts,
  Product,
  Transaction,
} from './types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api';

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = false } = options;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (auth) {
    const token = useAuthStore.getState().accessToken;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);
    throw new Error(message || `Request failed with status ${res.status}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

export const apiClient = {
  register: (input: { email: string; password: string; name: string }) =>
    request<AuthUser>('/auth/register', { method: 'POST', body: input }),

  login: (input: { email: string; password: string }) =>
    request<AuthTokens>('/auth/login', { method: 'POST', body: input }),

  refresh: (refreshToken: string) =>
    request<AuthTokens>('/auth/refresh', { method: 'POST', body: { refreshToken } }),

  logout: (refreshToken: string) =>
    request<void>('/auth/logout', { method: 'POST', body: { refreshToken }, auth: true }),

  me: () => request<AuthUser>('/auth/me', { auth: true }),

  getProducts: (params?: { page?: number; pageSize?: number; categoryId?: string }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.categoryId) query.set('categoryId', params.categoryId);
    const qs = query.toString();
    return request<PaginatedProducts>(`/catalog/products${qs ? `?${qs}` : ''}`);
  },

  getProduct: (id: string) => request<Product>(`/catalog/products/${id}`),

  getCategories: () => request<Category[]>('/catalog/categories'),

  getCart: (userId: string) => request<Cart>(`/cart?userId=${encodeURIComponent(userId)}`, { auth: true }),

  addCartItem: (input: {
    userId: string;
    productId: string;
    variantId?: string;
    name: string;
    unitPriceCents: number;
    quantity: number;
  }) => request<Cart>('/cart/items', { method: 'POST', body: input, auth: true }),

  removeCartItem: (userId: string, itemId: string) =>
    request<Cart>(`/cart/items/${itemId}?userId=${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      auth: true,
    }),

  checkout: (userId: string) =>
    request<Order>('/cart/checkout', { method: 'POST', body: { userId }, auth: true }),

  getOrder: (id: string) => request<Order>(`/orders/${id}`, { auth: true }),

  createPayment: (input: { orderId: string; userId: string; amountCents: number; currency: string }) =>
    request<Transaction>('/payments', { method: 'POST', body: input, auth: true }),

  getPayment: (id: string) => request<Transaction>(`/payments/${id}`, { auth: true }),

  getInstallmentPlanByOrderId: async (orderId: string): Promise<InstallmentPlan | null> => {
    const plans = await request<InstallmentPlan[]>(
      `/installment-plans?orderId=${encodeURIComponent(orderId)}`,
      { auth: true },
    );
    return plans[0] ?? null;
  },
};
