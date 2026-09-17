'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ecommerceApi } from '../../lib/ecommerce-api';
import type { Order } from '../../lib/ecommerce-types';
import { formatPrice } from '../../lib/format';
import { useRequireAuth } from '../../lib/use-require-auth';

const PAYMENT_STATUS_BADGE: Record<Order['paymentStatus'], { label: string; color: string; borderColor: string }> = {
  UNPAID: { label: 'Created', color: '#71717a', borderColor: '#e4e4e7' },
  PAID: { label: 'Paid', color: '#0f7b4f', borderColor: '#bbe3ce' },
  INSTALLMENTS_PENDING: { label: 'Installments pending', color: '#b3084a', borderColor: '#f6c2d6' },
  PARTIALLY_REFUNDED: { label: 'Partially refunded', color: '#b3084a', borderColor: '#f6c2d6' },
  DISPUTED: { label: 'Disputed', color: '#b45309', borderColor: '#fde3b8' },
  CHARGEBACK: { label: 'Chargeback', color: '#b91c1c', borderColor: '#fbd0d0' },
};

export default function OrdersListPage() {
  const router = useRouter();
  const { user, ready } = useRequireAuth();

  const ordersQuery = useQuery({
    queryKey: ['orders', user?.id],
    queryFn: () => ecommerceApi.getOrders(user!.id),
    enabled: !!user,
  });

  if (!ready) return null;

  const orders = ordersQuery.data ?? [];

  return (
    <div className="mx-auto max-w-[940px] px-5 pb-20 pt-10">
      <h1 className="m-0 mb-7 text-[38px] font-bold uppercase leading-none tracking-tight">Orders</h1>

      {ordersQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}

      {ordersQuery.data && orders.length === 0 && (
        <div className="flex flex-col items-center gap-3.5 border border-dashed border-[#d4d4d8] p-16 text-center">
          <span className="font-mono text-[11px] uppercase tracking-wide text-muted">No orders</span>
          <p className="m-0 text-[22px] font-bold tracking-tight">No orders yet</p>
          <button onClick={() => router.push('/')} className="bg-ink px-5 py-3 text-xs font-semibold uppercase tracking-wide text-white">
            Browse catalog
          </button>
        </div>
      )}

      {orders.length > 0 && (
        <div className="flex flex-col gap-3.5">
          {orders.map((order) => {
            const badge = PAYMENT_STATUS_BADGE[order.paymentStatus];
            return (
              <button
                key={order.id}
                onClick={() => router.push(`/orders/${order.id}`)}
                className="flex w-full items-center justify-between gap-5 border border-hair bg-white px-6 py-[22px] text-left hover:border-ink"
              >
                <span className="flex flex-col gap-1.5">
                  <span className="font-mono text-[11px] text-muted">#{order.id.slice(0, 8).toUpperCase()}</span>
                  <span className="text-base font-semibold">
                    {order.items.map((item) => item.name).join(' · ')}
                  </span>
                  <span className="font-mono text-[11px] text-[#71717a]">
                    {new Date(order.createdAt).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                </span>
                <span className="flex items-center gap-5">
                  <span
                    className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-wide"
                    style={{ color: badge.color, borderColor: badge.borderColor, border: '1px solid' }}
                  >
                    {badge.label}
                  </span>
                  <span className="text-lg font-bold">{formatPrice(order.totalCents, order.currency)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
