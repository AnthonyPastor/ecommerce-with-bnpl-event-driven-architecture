import { ECOMMERCE_BASE_URL } from './config';
import { createHttpClient } from './http';
import type { AuthTokens, AuthUser, Cart, Category, Order, PaginatedProducts, Product } from './ecommerce-types';

const request = createHttpClient(ECOMMERCE_BASE_URL);

export const ecommerceApi = {
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

  updateCartItem: (userId: string, itemId: string, quantity: number) =>
    request<Cart>(`/cart/items/${itemId}?userId=${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: { quantity },
      auth: true,
    }),

  removeCartItem: (userId: string, itemId: string) =>
    request<Cart>(`/cart/items/${itemId}?userId=${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      auth: true,
    }),

  checkout: (userId: string) =>
    request<Order>('/cart/checkout', { method: 'POST', body: { userId }, auth: true }),

  getOrder: (id: string) => request<Order>(`/orders/${id}`, { auth: true }),

  getOrders: (userId: string) => request<Order[]>(`/orders?userId=${encodeURIComponent(userId)}`, { auth: true }),
};
