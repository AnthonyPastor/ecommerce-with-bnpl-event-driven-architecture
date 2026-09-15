'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { apiClient } from '../../../lib/api-client';
import { formatPrice } from '../../../lib/format';
import type { PaymentStatus } from '../../../lib/types';
import { useAuthStore } from '../../../store/auth-store';

const TERMINAL_STATUSES: PaymentStatus[] = [
  'CAPTURED',
  'AUTHORIZATION_FAILED',
  'CAPTURE_FAILED',
  'VOIDED',
  'CANCELLED',
];

export default function OrderConfirmationPage() {
  const { id } = useParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const [transactionId, setTransactionId] = useState<string | null>(null);

  const orderQuery = useQuery({
    queryKey: ['order', id],
    queryFn: () => apiClient.getOrder(id),
  });

  const pay = useMutation({
    mutationFn: () => {
      if (!orderQuery.data || !user) throw new Error('order not loaded');
      return apiClient.createPayment({
        orderId: orderQuery.data.id,
        userId: user.id,
        amountCents: orderQuery.data.totalCents,
        currency: orderQuery.data.currency,
      });
    },
    onSuccess: (transaction) => setTransactionId(transaction.id),
  });

  const paymentQuery = useQuery({
    queryKey: ['payment', transactionId],
    queryFn: () => apiClient.getPayment(transactionId!),
    enabled: !!transactionId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && TERMINAL_STATUSES.includes(status) ? false : 1000;
    },
  });

  const isCaptured = paymentQuery.data?.status === 'CAPTURED';

  const planQuery = useQuery({
    queryKey: ['installment-plan', id],
    queryFn: () => apiClient.getInstallmentPlanByOrderId(id),
    enabled: isCaptured,
    refetchInterval: (query) => (query.state.data ? false : 1000),
  });

  if (orderQuery.isLoading) return <main className="mx-auto max-w-2xl px-4 py-8">Loading order...</main>;
  if (orderQuery.isError || !orderQuery.data) {
    return <main className="mx-auto max-w-2xl px-4 py-8 text-red-600">Order not found.</main>;
  }

  const order = orderQuery.data;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-2 text-xl font-semibold text-gray-900">Order #{order.id.slice(0, 8)}</h1>
      <p className="mb-6 text-sm text-gray-500">Order status: {order.status}</p>

      <ul className="mb-6 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
        {order.items.map((item) => (
          <li key={item.id} className="flex items-center justify-between p-4 text-sm">
            <span>
              {item.name} x{item.quantity}
            </span>
            <span>{formatPrice(item.unitPriceCents * item.quantity, order.currency)}</span>
          </li>
        ))}
      </ul>

      <div className="mb-6 flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
        <span className="text-sm font-medium">Total</span>
        <span className="text-lg font-semibold">{formatPrice(order.totalCents, order.currency)}</span>
      </div>

      {!transactionId && (
        <button
          onClick={() => pay.mutate()}
          disabled={pay.isPending}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {pay.isPending ? 'Starting payment...' : 'Pay with BNPL'}
        </button>
      )}
      {pay.isError && <p className="mt-2 text-sm text-red-600">We couldn&apos;t start the payment.</p>}

      {paymentQuery.data && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 text-sm">
          <p>
            Payment status: <span className="font-medium">{paymentQuery.data.status}</span>
          </p>
          {!isCaptured && (
            <p className="mt-1 text-xs text-gray-500">
              Confirming the capture with the payment gateway (this can take a few seconds)...
            </p>
          )}
        </div>
      )}

      {isCaptured && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Installment plan</h2>
          {!planQuery.data && <p className="text-xs text-gray-500">Generating your installment plan...</p>}
          {planQuery.data && (
            <ul className="divide-y divide-gray-200">
              {planQuery.data.installments.map((inst) => (
                <li key={inst.id} className="flex items-center justify-between py-2 text-sm">
                  <span>Installment {inst.installmentNumber}</span>
                  <span>{formatPrice(inst.amountCents, planQuery.data!.currency)}</span>
                  <span className="text-xs text-gray-500">
                    Due {new Date(inst.dueDate).toLocaleDateString('en-US')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}
