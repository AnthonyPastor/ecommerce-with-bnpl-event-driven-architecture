'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { bnplApi } from '../../../lib/bnpl-api';
import { ecommerceApi } from '../../../lib/ecommerce-api';
import { formatPrice } from '../../../lib/format';
import { TERMINAL_PAYMENT_STATUSES } from '../../../lib/bnpl-types';
import { useRequireAuth } from '../../../lib/use-require-auth';

function dueDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
}

export default function PaymentDetailPage() {
  return (
    <Suspense fallback={null}>
      <PaymentDetailContent />
    </Suspense>
  );
}

function PaymentDetailContent() {
  const { orderId } = useParams<{ orderId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const transactionId = searchParams.get('tx');
  const { ready } = useRequireAuth();

  const orderQuery = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => ecommerceApi.getOrder(orderId),
  });

  const paymentQuery = useQuery({
    queryKey: ['payment', transactionId],
    queryFn: () => bnplApi.getPayment(transactionId!),
    enabled: !!transactionId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && TERMINAL_PAYMENT_STATUSES.includes(status) ? false : 1000;
    },
  });

  const planQuery = useQuery({
    queryKey: ['installment-plan', orderId],
    queryFn: () => bnplApi.getInstallmentPlanByOrderId(orderId),
    enabled: paymentQuery.data?.status === 'CAPTURED' && paymentQuery.data?.paymentMethod === 'INSTALLMENTS',
  });

  if (!ready) return null;
  if (orderQuery.isLoading || paymentQuery.isLoading) {
    return <div className="mx-auto max-w-[880px] px-5 py-10 text-sm text-muted">Loading…</div>;
  }
  if (!orderQuery.data || !transactionId) {
    return <div className="mx-auto max-w-[880px] px-5 py-10 text-sm text-red-600">No payment to show for this order.</div>;
  }

  const order = orderQuery.data;
  const tx = paymentQuery.data;
  const isPlan = tx?.status === 'CAPTURED' && tx.paymentMethod === 'INSTALLMENTS';
  const isFull = tx?.status === 'CAPTURED' && tx.paymentMethod === 'FULL';
  const isFailed = tx?.status === 'CAPTURE_FAILED' || tx?.status === 'AUTHORIZATION_FAILED';
  const inProgress = !isPlan && !isFull && !isFailed;

  const installments = planQuery.data?.installments ?? [];
  const paidCents = installments.filter((i) => i.status === 'PAID').reduce((s, i) => s + i.amountCents, 0);
  const remainingCents = installments.filter((i) => i.status !== 'PAID').reduce((s, i) => s + i.amountCents, 0);
  const paidCount = installments.filter((i) => i.status === 'PAID').length;
  const next = installments.find((i) => i.status !== 'PAID');

  return (
    <div className="mx-auto max-w-[880px] px-5 pb-20 pt-6">
      <button
        onClick={() => router.push(`/orders/${orderId}?tx=${transactionId}`)}
        className="mb-[22px] font-mono text-[11px] uppercase tracking-wide text-[#71717a]"
      >
        ← Back to order
      </button>

      <div className="mb-[30px] flex flex-col gap-2.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted">
          Payment for order #{order.id.slice(0, 8).toUpperCase()}
        </span>
        <h1 className="m-0 text-4xl font-bold leading-[1.05] tracking-tight">
          {isFailed ? 'Payment declined' : isFull ? 'Paid in full' : isPlan ? '3 interest-free installments' : 'Payment'}
        </h1>
        <p className="m-0 max-w-[520px] text-[15px] leading-relaxed text-[#52525b]">
          {isFailed
            ? 'The gateway rejected this charge, so no money was taken and no installment plan was created.'
            : isPlan
              ? 'One charge today, the other two every 30 days.'
              : isFull
                ? 'Veloce Pay · single charge'
                : 'The gateway is still confirming this charge. The breakdown appears once it is captured.'}
        </p>
      </div>

      {isPlan && (
        <div className="flex flex-col gap-7">
          <div className="flex flex-wrap gap-5">
            <div className="flex-1 basis-[190px] border border-hair p-[22px]">
              <div className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[#71717a]">Remaining</div>
              <div className="text-[30px] font-bold tracking-tight">{formatPrice(remainingCents, order.currency)}</div>
            </div>
            <div className="flex-1 basis-[190px] border border-hair p-[22px]">
              <div className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[#71717a]">Paid so far</div>
              <div className="text-[30px] font-bold tracking-tight">{formatPrice(paidCents, order.currency)}</div>
              <div className="mt-1.5 font-mono text-[11px] text-[#71717a]">{paidCount} of 3</div>
            </div>
            <div className="flex-1 basis-[190px] bg-ink p-[22px] text-white">
              <div className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-accent">Next charge</div>
              <div className="text-[30px] font-bold tracking-tight">
                {next ? formatPrice(next.amountCents, order.currency) : 'Nothing due'}
              </div>
              <div className="mt-1.5 font-mono text-[11px] text-[#d4d4d8]">{next ? dueDate(next.dueDate) : '—'}</div>
            </div>
          </div>
          <div className="border border-hair">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-hair px-[22px] py-[18px]">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em]">Charges</span>
              <span className="font-mono text-[11px] text-[#71717a]">Veloce Pay · 3 installments</span>
            </div>
            {installments.map((inst) => (
              <div key={inst.id} className="flex items-center justify-between gap-4 border-b border-[#f0f0f2] px-[22px] py-4">
                <span className="flex items-center gap-3.5">
                  <span
                    className="flex h-[26px] w-[26px] items-center justify-center border font-mono text-[11px] font-semibold"
                    style={{
                      background: inst.status === 'PAID' ? '#0b0b0c' : '#ffffff',
                      color: inst.status === 'PAID' ? '#ffffff' : '#0b0b0c',
                      borderColor: inst.status === 'PAID' ? '#0b0b0c' : '#e4e4e7',
                    }}
                  >
                    {inst.installmentNumber}
                  </span>
                  <span className="text-sm font-semibold">Installment {inst.installmentNumber}</span>
                  <span className="font-mono text-[11px] text-[#71717a]">{dueDate(inst.dueDate)}</span>
                </span>
                <span className="flex items-center gap-4">
                  <span className="border px-1.5 py-1 font-mono text-[10px] uppercase tracking-wide" style={{ color: '#71717a', borderColor: '#e4e4e7' }}>
                    {inst.status}
                  </span>
                  <span className="min-w-[76px] text-right text-[15px] font-bold">{formatPrice(inst.amountCents, order.currency)}</span>
                </span>
              </div>
            ))}
            <div className="flex items-baseline justify-between bg-[#fafafa] px-[22px] py-[18px]">
              <span className="text-xs font-semibold uppercase tracking-wide">Total financed</span>
              <span className="text-xl font-bold">{formatPrice(order.totalCents, order.currency)}</span>
            </div>
          </div>
        </div>
      )}

      {isFull && tx && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2 border border-ink p-8">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#71717a]">Amount charged</span>
            <span className="text-[44px] font-bold leading-none tracking-tight">{formatPrice(tx.amountCents, order.currency)}</span>
            <span className="max-w-[420px] text-[13px] leading-relaxed text-[#71717a]">
              The full amount was charged in one transaction. There is nothing left to pay on this order.
            </span>
          </div>
          <div className="border border-hair">
            <div className="border-b border-hair px-[22px] py-[18px]">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em]">Receipt</span>
            </div>
            {[
              ['Method', 'Veloce Pay · single charge'],
              ['Charged on', new Date(order.createdAt).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })],
              ['Transaction reference', `tx_${tx.id.slice(0, 8)}`],
              ['Order items', `${order.items.reduce((s, i) => s + i.quantity, 0)} items`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-[#f0f0f2] px-[22px] py-4">
                <span className="text-[13px] text-[#71717a]">{k}</span>
                <span className="text-right text-[13px] font-semibold">{v}</span>
              </div>
            ))}
            <div className="flex items-baseline justify-between bg-[#fafafa] px-[22px] py-[18px]">
              <span className="text-xs font-semibold uppercase tracking-wide">Remaining</span>
              <span className="text-xl font-bold">Nothing due</span>
            </div>
          </div>
        </div>
      )}

      {isFailed && tx && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2 border border-hair border-l-[3px] border-l-red-600 p-8">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-red-600">No charge applied</span>
            <span className="text-[44px] font-bold leading-none tracking-tight text-[#71717a] line-through">
              {formatPrice(tx.amountCents, order.currency)}
            </span>
            <span className="max-w-[440px] text-[13px] leading-relaxed text-[#71717a]">
              No charge was applied. Check your payment method and try again.
            </span>
          </div>
          <div className="border border-hair">
            <div className="border-b border-hair px-[22px] py-[18px]">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em]">Receipt</span>
            </div>
            {[
              ['Method', tx.paymentMethod === 'FULL' ? 'Veloce Pay · single charge' : 'Veloce Pay · 3 installments'],
              ['Attempted amount', formatPrice(tx.amountCents, order.currency)],
              ['Transaction reference', `tx_${tx.id.slice(0, 8)}`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-[#f0f0f2] px-[22px] py-4">
                <span className="text-[13px] text-[#71717a]">{k}</span>
                <span className="text-right text-[13px] font-semibold">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {inProgress && (
        <div className="flex items-center gap-3.5 border border-hair p-7">
          <span className="block h-[15px] w-[15px] animate-vspin rounded-full border-2 border-hair border-t-accent" />
          <span className="text-sm leading-relaxed text-[#52525b]">
            The gateway is still confirming this charge. The breakdown appears once it is captured.
          </span>
        </div>
      )}
    </div>
  );
}
