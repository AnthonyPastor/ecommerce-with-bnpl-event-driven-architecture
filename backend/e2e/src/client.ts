const BASE_URL = process.env.GATEWAY_URL ?? 'http://localhost:3000/api';

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  return { status: res.status, body };
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export const api = {
  register: (input: { email: string; password: string; name: string }) =>
    request<{ id: string; email: string; name: string }>('/auth/register', { method: 'POST', body: input }),

  login: (input: { email: string; password: string }) =>
    request<AuthTokens>('/auth/login', { method: 'POST', body: input }),

  listProducts: (pageSize = 1) =>
    request<{ items: Array<{ id: string; name: string; priceCents: number }> }>(
      `/catalog/products?pageSize=${pageSize}`,
    ),

  addToCart: (
    token: string,
    input: { userId: string; productId: string; name: string; unitPriceCents: number; quantity: number },
  ) => request('/cart/items', { method: 'POST', body: input, token }),

  checkout: (token: string, userId: string) =>
    request<{ id: string; status: string; totalCents: number }>('/cart/checkout', {
      method: 'POST',
      body: { userId },
      token,
    }),

  getOrder: (token: string, orderId: string) =>
    request<{ id: string; status: string }>(`/orders/${orderId}`, { token }),

  pay: (
    token: string,
    input: {
      orderId: string;
      userId: string;
      amountCents: number;
      currency: string;
      paymentMethod?: 'FULL' | 'INSTALLMENTS';
    },
  ) => request<{ id: string; status: string }>('/payments', { method: 'POST', body: input, token }),

  getPayment: (token: string, transactionId: string) =>
    request<{ id: string; status: string }>(`/payments/${transactionId}`, { token }),

  refundPayment: (token: string, transactionId: string, amountCents?: number) =>
    request<{ status: string }>(`/payments/${transactionId}/refund`, {
      method: 'POST',
      body: { amountCents },
      token,
    }),

  voidPayment: (token: string, transactionId: string) =>
    request<{ status: string }>(`/payments/${transactionId}/void`, { method: 'POST', token }),

  getInstallmentPlans: (token: string, orderId: string) =>
    request<Array<{ id: string; status: string; installments: Array<{ status: string; amountCents: number }> }>>(
      `/installment-plans?orderId=${orderId}`,
      { token },
    ),

  getNotifications: (token: string, to: string) =>
    request<Array<{ template: string; to: string }>>(`/notifications?to=${to}`, { token }),
};

export function decodeJwtSub(accessToken: string): string {
  const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString());
  return payload.sub;
}

/** Espera hasta que `check()` devuelva true, reintentando cada `intervalMs` hasta `timeoutMs`. */
export async function waitUntil(check: () => Promise<boolean>, timeoutMs = 15000, intervalMs = 300): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
}

export async function registerAndLogin(namePrefix: string): Promise<{ token: string; userId: string }> {
  const email = `${namePrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@bnpl.test`;
  await api.register({ email, password: 'secret1234', name: namePrefix });
  const login = await api.login({ email, password: 'secret1234' });
  const token = login.body.accessToken;
  return { token, userId: decodeJwtSub(token) };
}
