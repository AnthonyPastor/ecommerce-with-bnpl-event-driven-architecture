import { BNPL_BASE_URL } from './config';
import { createHttpClient } from './http';
import type { InstallmentPlan, PaymentMethod, Transaction } from './bnpl-types';

const request = createHttpClient(BNPL_BASE_URL);

export const bnplApi = {
  createPayment: (input: {
    orderId: string;
    userId: string;
    amountCents: number;
    currency: string;
    paymentMethod: PaymentMethod;
  }) => request<Transaction>('/payments', { method: 'POST', body: input, auth: true }),

  getPayment: (id: string) => request<Transaction>(`/payments/${id}`, { auth: true }),

  getPaymentByOrderId: async (orderId: string): Promise<Transaction | null> => {
    const transactions = await request<Transaction[]>(`/payments?orderId=${encodeURIComponent(orderId)}`, {
      auth: true,
    });
    return transactions[0] ?? null;
  },

  getInstallmentPlanByOrderId: async (orderId: string): Promise<InstallmentPlan | null> => {
    const plans = await request<InstallmentPlan[]>(
      `/installment-plans?orderId=${encodeURIComponent(orderId)}`,
      { auth: true },
    );
    return plans[0] ?? null;
  },
};
