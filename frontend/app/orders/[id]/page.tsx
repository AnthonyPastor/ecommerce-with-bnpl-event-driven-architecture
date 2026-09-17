'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { bnplApi } from '../../../lib/bnpl-api';
import { ecommerceApi } from '../../../lib/ecommerce-api';
import { formatPrice } from '../../../lib/format';
import { TERMINAL_PAYMENT_STATUSES } from '../../../lib/bnpl-types';
import { useRequireAuth } from '../../../lib/use-require-auth';

const TX_LABELS: Record<string, { label: string; hint: string; dot: string; idx: number }> = {
  PENDING: { label: 'Payment started', hint: 'We sent the request to the gateway. This takes a few seconds.', dot: '#a16207', idx: 0 },
  AUTHORIZED: { label: 'Authorized', hint: 'Confirming the capture with the payment gateway…', dot: '#a16207', idx: 1 },
  CAPTURED: { label: 'Captured', hint: 'Capture confirmed.', dot: '#0f7b4f', idx: 2 },
  CAPTURE_FAILED: { label: 'Payment declined', hint: 'The gateway declined the charge. No installment plan was created.', dot: '#dc2626', idx: 1 },
  AUTHORIZATION_FAILED: { label: 'Payment declined', hint: 'The gateway declined the charge. No installment plan was created.', dot: '#dc2626', idx: 1 },
};

function dueDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
}

export default function OrderConfirmationPage() {
  return (
    <Suspense fallback={null}>
      <OrderConfirmationContent />
    </Suspense>
  );
}

function OrderConfirmationContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const txParam = searchParams.get('tx');
  const { ready } = useRequireAuth();

  const orderQuery = useQuery({
    queryKey: ['order', id],
    queryFn: () => ecommerceApi.getOrder(id),
  });

  // Visiting an already-CONFIRMED order with no ?tx= (e.g. from /orders) has
  // no transactionId to poll — resolve it from the order itself instead of
  // falling through to "Go to checkout" and letting the order be paid again.
  const paymentByOrderQuery = useQuery({
    queryKey: ['payment-by-order', id],
    queryFn: () => bnplApi.getPaymentByOrderId(id),
    enabled: !txParam && orderQuery.data?.status === 'CONFIRMED',
  });

  const transactionId = txParam ?? paymentByOrderQuery.data?.id ?? null;

  // Only poll by id when we arrived via ?tx= (a payment in flight). When
  // resolved from the order instead, that transaction is necessarily already
  // terminal (an order only reaches CONFIRMED after a capture) and
  // paymentByOrderQuery above already fetched the same row — don't fetch it twice.
  const paymentQuery = useQuery({
    queryKey: ['payment', transactionId],
    queryFn: () => bnplApi.getPayment(transactionId!),
    enabled: !!txParam,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && TERMINAL_PAYMENT_STATUSES.includes(status) ? false : 1000;
    },
  });

  const tx = txParam ? paymentQuery.data : paymentByOrderQuery.data;
  const isCaptured = tx?.status === 'CAPTURED';
  const isFailed = tx?.status === 'CAPTURE_FAILED' || tx?.status === 'AUTHORIZATION_FAILED';
  const paidInFull = isCaptured && tx?.paymentMethod === 'FULL';
  const wantsPlan = isCaptured && tx?.paymentMethod === 'INSTALLMENTS';
  // Nothing successfully paid yet: either there's no known transaction, or the
  // one we know about ended in a failed state and needs a fresh attempt.
  const awaitingPayment = orderQuery.data?.status !== 'CONFIRMED' && (!transactionId || isFailed);

  const planQuery = useQuery({
    queryKey: ['installment-plan', id],
    queryFn: () => bnplApi.getInstallmentPlanByOrderId(id),
    enabled: wantsPlan,
    refetchInterval: (query) => (query.state.data ? false : 1000),
  });

  if (!ready) return null;
  if (orderQuery.isLoading) return <div className="mx-auto max-w-[880px] px-5 py-10 text-sm text-muted">Loading order…</div>;
  if (orderQuery.isError || !orderQuery.data) {
    return <div className="mx-auto max-w-[880px] px-5 py-10 text-sm text-red-600">Order not found.</div>;
  }

  const order = orderQuery.data;
  const txInfo = tx ? TX_LABELS[tx.status] ?? TX_LABELS.PENDING : TX_LABELS.PENDING;
  const terminal = !!tx && TERMINAL_PAYMENT_STATUSES.includes(tx.status);

  return (
    <div className="mx-auto flex max-w-[880px] flex-col gap-7 px-5 pb-20 pt-10">
      <div className="flex flex-col gap-2.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted">
          ORDER #{order.id.slice(0, 8).toUpperCase()}
        </span>
        <h1 className="m-0 text-4xl font-bold leading-[1.05] tracking-tight">
          {isFailed
            ? "We couldn't charge this order"
            : awaitingPayment
              ? 'Order created'
              : isCaptured
                ? 'Done. Order confirmed'
                : 'Confirming your payment'}
        </h1>
        <p className="m-0 max-w-[520px] text-[15px] leading-relaxed text-[#52525b]">
          {isFailed
            ? 'No charge was applied. Check your payment method and try again.'
            : awaitingPayment
              ? 'This order has not been paid yet.'
              : isCaptured
                ? paidInFull
                  ? 'We emailed your receipt. The full amount was charged at once.'
                  : 'We emailed your receipt. Your three-installment schedule is below.'
                : 'You can leave this screen open: it updates itself as soon as the gateway responds.'}
        </p>
      </div>

      {transactionId && (
        <div className="flex flex-col gap-[18px] border border-hair p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="flex items-center gap-2.5">
              <span
                className="block h-[9px] w-[9px] rounded-full"
                style={{ background: txInfo.dot, animation: terminal ? 'none' : 'vpulse 1.4s ease-in-out infinite' }}
              />
              <span className="font-mono text-xs font-semibold tracking-wide">{txInfo.label}</span>
            </span>
            <span className="font-mono text-[11px] text-muted">{terminal ? 'final state' : 'polling every 1s'}</span>
          </div>
          <div className="flex gap-1">
            {['Payment started', 'Authorized', isFailed ? 'Payment declined' : 'Captured'].map((label, idx) => (
              <div key={label} className="flex flex-1 flex-col gap-1.5">
                <span
                  className="block h-[3px]"
                  style={{ background: idx <= txInfo.idx ? (isFailed && idx === 2 ? '#dc2626' : idx === 2 ? '#0f7b4f' : '#ff2d6f') : '#e4e4e7' }}
                />
                <span
                  className="font-mono text-[9px] uppercase tracking-wide"
                  style={{ color: idx <= txInfo.idx ? '#0b0b0c' : '#a1a1aa' }}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
          <p className="m-0 text-[13px] leading-relaxed text-[#71717a]">{txInfo.hint}</p>
        </div>
      )}

      {paidInFull && (
        <div className="flex flex-col gap-1.5 border border-hair p-6">
          <span className="text-base font-bold tracking-tight">Paid in a single charge</span>
          <span className="text-[13px] text-[#71717a]">This order has no installment plan attached.</span>
        </div>
      )}

      {wantsPlan && !planQuery.data && (
        <div className="flex items-center gap-3.5 border border-hair p-6">
          <span className="block h-[15px] w-[15px] animate-vspin rounded-full border-2 border-hair border-t-accent" />
          <span className="text-sm text-[#52525b]">Generating your installment plan…</span>
        </div>
      )}

      {wantsPlan && planQuery.data && (
        <div className="border border-ink">
          <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-hair px-6 py-5">
            <span className="text-lg font-bold tracking-tight">Installment plan</span>
            <span className="font-mono text-[11px] uppercase tracking-wide text-accenttext">Active</span>
          </div>
          {planQuery.data.installments.map((inst) => (
            <div key={inst.id} className="flex items-center justify-between gap-4 border-b border-[#f0f0f2] px-6 py-4">
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
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">Installment {inst.installmentNumber} of 3</span>
                  <span className="font-mono text-[11px] text-[#71717a]">{dueDate(inst.dueDate)}</span>
                </span>
              </span>
              <span className="flex items-center gap-4">
                <span className="border px-1.5 py-1 font-mono text-[10px] uppercase tracking-wide" style={{ color: '#71717a', borderColor: '#e4e4e7' }}>
                  {inst.status}
                </span>
                <span className="min-w-[76px] text-right text-base font-bold">{formatPrice(inst.amountCents, order.currency)}</span>
              </span>
            </div>
          ))}
          <div className="flex items-baseline justify-between bg-[#fafafa] px-6 py-[18px]">
            <span className="text-xs font-semibold uppercase tracking-wide">Total financed</span>
            <span className="text-xl font-bold">{formatPrice(order.totalCents, order.currency)}</span>
          </div>
        </div>
      )}

      <div className="border border-hair">
        <div className="border-b border-hair px-6 py-[18px]">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em]">Order items</span>
        </div>
        {order.items.map((item) => (
          <div key={item.id} className="flex justify-between gap-4 border-b border-[#f0f0f2] px-6 py-4">
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">{item.name}</span>
              <span className="font-mono text-[11px] text-[#71717a]">Qty {item.quantity}</span>
            </span>
            <span className="text-sm font-bold">{formatPrice(item.unitPriceCents * item.quantity, order.currency)}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        {transactionId && (
          <button
            onClick={() => router.push(`/payment/${order.id}?tx=${transactionId}`)}
            className="border border-ink px-5 py-3.5 text-xs font-semibold uppercase tracking-wide"
          >
            View payment
          </button>
        )}
        {awaitingPayment && (
          <button
            onClick={() => router.push(`/checkout/${order.id}`)}
            className="bg-ink px-5 py-3.5 text-xs font-semibold uppercase tracking-wide text-white"
          >
            Go to checkout
          </button>
        )}
        <button onClick={() => router.push('/')} className="px-0 py-3.5 text-xs font-semibold uppercase tracking-wide text-[#71717a]">
          Keep shopping
        </button>
      </div>
    </div>
  );
}
