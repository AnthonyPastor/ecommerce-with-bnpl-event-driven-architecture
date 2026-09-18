'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { bnplApi } from '../../../lib/bnpl-api';
import { ecommerceApi } from '../../../lib/ecommerce-api';
import { formatPrice } from '../../../lib/format';
import { NON_BLOCKING_PAYMENT_STATUSES, type PaymentMethod } from '../../../lib/bnpl-types';
import { useRequireAuth } from '../../../lib/use-require-auth';

const STEPS = ['Shipping', 'Plan', 'Review'];

function splitInThree(totalCents: number): number[] {
  const per = Math.floor(totalCents / 3);
  const remainder = totalCents - per * 3;
  return [per, per, per + remainder];
}

function dueLabel(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return daysFromNow === 0 ? 'today' : d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
}

export default function CheckoutPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const router = useRouter();
  const { user, ready } = useRequireAuth();
  const [step, setStep] = useState(1);
  const [shipping, setShipping] = useState<'standard' | 'express'>('standard');
  const [payMode, setPayMode] = useState<PaymentMethod>('INSTALLMENTS');

  const orderQuery = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => ecommerceApi.getOrder(orderId),
  });

  // An order can already have a payment that's in flight (PENDING/AUTHORIZED)
  // or blocking (e.g. PARTIALLY_REFUNDED/DISPUTED) without being CONFIRMED yet
  // — payment-service's own createPayment guard rejects a second attempt for
  // any of those. Check for one before ever showing the wizard, otherwise a
  // user who navigates away mid-payment and comes back gets stuck retrying
  // into a 409 with no way out (see the CONFIRMED bounce below for the
  // captured/settled case).
  const paymentByOrderQuery = useQuery({
    queryKey: ['payment-by-order', orderId],
    queryFn: () => bnplApi.getPaymentByOrderId(orderId),
    enabled: orderQuery.data?.status !== undefined && orderQuery.data.status !== 'CONFIRMED',
  });
  const blockingTransaction =
    paymentByOrderQuery.data && !NON_BLOCKING_PAYMENT_STATUSES.includes(paymentByOrderQuery.data.status)
      ? paymentByOrderQuery.data
      : null;

  // An order that already went through a successful payment must not be
  // payable again — bounce back to its confirmation/receipt page instead of
  // rendering the payment-method wizard. (Defense in depth: the entry point
  // from /orders already hides the "Go to checkout" link for a CONFIRMED
  // order, but this route is still reachable directly, e.g. via back-button.)
  // Same for an order with a blocking transaction still in flight: resume
  // polling it on the order page instead of letting the wizard render.
  useEffect(() => {
    if (orderQuery.data?.status === 'CONFIRMED') {
      router.replace(`/orders/${orderId}`);
    } else if (blockingTransaction) {
      router.replace(`/orders/${orderId}?tx=${blockingTransaction.id}`);
    }
  }, [orderQuery.data?.status, blockingTransaction, orderId, router]);

  const pay = useMutation({
    mutationFn: () => {
      if (!orderQuery.data || !user) throw new Error('order not loaded');
      return bnplApi.createPayment({
        orderId: orderQuery.data.id,
        userId: user.id,
        amountCents: totalCents,
        currency: orderQuery.data.currency,
        paymentMethod: payMode,
      });
    },
    onSuccess: (transaction) => router.push(`/orders/${orderId}?tx=${transaction.id}`),
  });

  if (!ready) return null;
  if (orderQuery.isLoading) return <div className="mx-auto max-w-[1040px] px-5 py-10 text-sm text-muted">Loading order…</div>;
  if (orderQuery.isError || !orderQuery.data) {
    return <div className="mx-auto max-w-[1040px] px-5 py-10 text-sm text-red-600">Order not found.</div>;
  }
  if (orderQuery.data.status === 'CONFIRMED') return null;
  if (paymentByOrderQuery.isLoading) {
    return <div className="mx-auto max-w-[1040px] px-5 py-10 text-sm text-muted">Loading order…</div>;
  }
  if (blockingTransaction) return null;

  const order = orderQuery.data;
  const shippingCents = shipping === 'express' ? 1200 : 0;
  const totalCents = order.totalCents + shippingCents;
  const plan = splitInThree(totalCents);
  const dueToday = payMode === 'FULL' ? totalCents : plan[0];

  return (
    <div className="mx-auto w-full max-w-[1040px] px-5 pb-20 pt-10">
      <div className="mb-9 flex border-b border-hair">
        {STEPS.map((label, idx) => {
          const n = idx + 1;
          const on = step === n;
          const done = step > n;
          return (
            <div
              key={label}
              className="flex flex-1 items-center gap-2.5 pb-3.5"
              style={{ borderBottom: `2px solid ${on ? '#ff2d6f' : done ? '#0b0b0c' : 'transparent'}` }}
            >
              <span
                className="flex h-[22px] w-[22px] items-center justify-center rounded-full font-mono text-[11px] font-semibold"
                style={{ background: on ? '#ff2d6f' : done ? '#0b0b0c' : '#f4f4f5', color: on || done ? '#ffffff' : '#a1a1aa' }}
              >
                {n}
              </span>
              <span className={`text-[13px] font-semibold uppercase tracking-wide ${on || done ? 'text-ink' : 'text-muted'}`}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-start gap-10">
        <div className="min-w-[300px] flex-1 basis-[440px]">
          {step === 1 && (
            <div className="flex flex-col gap-5">
              <h2 className="m-0 text-[26px] font-bold tracking-tight">Shipping method</h2>
              {(
                [
                  ['standard', 'Standard', '3-5 business days', 'Free'],
                  ['express', 'Express', '24-48 hours', formatPrice(1200, 'USD')],
                ] as const
              ).map(([id, title, eta, price]) => {
                const on = shipping === id;
                return (
                  <button
                    key={id}
                    onClick={() => setShipping(id)}
                    className="flex w-full items-center gap-4 border px-5 py-[18px] text-left"
                    style={{ borderColor: on ? '#0b0b0c' : '#e4e4e7', background: on ? '#fafafa' : '#ffffff' }}
                  >
                    <span
                      className="block h-[18px] w-[18px] shrink-0 rounded-full"
                      style={{ border: `5px solid ${on ? '#ff2d6f' : '#e4e4e7'}` }}
                    />
                    <span className="flex flex-1 flex-col gap-1">
                      <span className="text-[15px] font-semibold">{title}</span>
                      <span className="text-[13px] text-[#71717a]">{eta}</span>
                    </span>
                    <span className="font-mono text-[13px] font-semibold">{price}</span>
                  </button>
                );
              })}
              <p className="m-0 border-l-2 border-hair pl-3 text-xs leading-relaxed text-muted">
                The backend does not store a shipping address yet: this step only picks the method and its cost.
              </p>
              <button
                onClick={() => setStep(2)}
                className="self-start bg-ink px-[26px] py-3.5 text-[13px] font-semibold uppercase tracking-wide text-white"
              >
                Continue
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-5">
              <h2 className="m-0 text-[26px] font-bold tracking-tight">How do you want to pay</h2>
              <div className="flex flex-col gap-3">
                {(
                  [
                    ['INSTALLMENTS', '3 interest-free installments', 'One charge today, the other two every 30 days.', `3 × ${formatPrice(plan[0], 'USD')}`],
                    ['FULL', 'Pay in full', 'One charge today, when the order is confirmed.', formatPrice(totalCents, 'USD')],
                  ] as const
                ).map(([id, title, sub, price]) => {
                  const on = payMode === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setPayMode(id)}
                      className="flex w-full items-center gap-4 border px-5 py-[18px] text-left"
                      style={{ borderColor: on ? '#0b0b0c' : '#e4e4e7', background: on ? '#fafafa' : '#ffffff' }}
                    >
                      <span
                        className="block h-[18px] w-[18px] shrink-0 rounded-full"
                        style={{ border: `5px solid ${on ? '#ff2d6f' : '#e4e4e7'}` }}
                      />
                      <span className="flex flex-1 flex-col gap-1">
                        <span className="text-[15px] font-semibold">{title}</span>
                        <span className="text-[13px] text-[#71717a]">{sub}</span>
                      </span>
                      <span className="text-right font-mono text-[13px] font-semibold">{price}</span>
                    </button>
                  );
                })}
              </div>

              {payMode === 'INSTALLMENTS' && (
                <div className="flex flex-col gap-[18px] border border-ink p-6">
                  <div className="flex flex-col gap-px bg-hair">
                    {plan.map((amount, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-white px-4 py-3.5">
                        <span className="flex items-center gap-3">
                          <span className="block h-[7px] w-[7px]" style={{ background: idx === 0 ? '#ff2d6f' : '#d4d4d8' }} />
                          <span className="text-sm font-semibold">Installment {idx + 1}</span>
                          <span className="font-mono text-[11px] text-[#71717a]">+{idx * 30}d</span>
                        </span>
                        <span className="flex items-baseline gap-3.5">
                          <span className="font-mono text-[11px] text-[#71717a]">{dueLabel(idx * 30)}</span>
                          <span className="text-[15px] font-bold">{formatPrice(amount, 'USD')}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                  <span className="text-xs leading-relaxed text-[#71717a]">
                    The plan is generated by bnpl-service once the capture is confirmed. Today it is three fixed
                    installments.
                  </span>
                </div>
              )}
              {payMode === 'FULL' && (
                <p className="m-0 border-l-2 border-hair pl-3 text-xs leading-relaxed text-[#71717a]">
                  The full amount is charged at once. No installment plan is created.
                </p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  className="border border-hair px-[22px] py-3.5 text-[13px] font-semibold uppercase tracking-wide text-[#52525b]"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  className="bg-ink px-[26px] py-3.5 text-[13px] font-semibold uppercase tracking-wide text-white"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-5">
              <h2 className="m-0 text-[26px] font-bold tracking-tight">Review and pay</h2>
              <div className="border border-hair">
                {order.items.map((item) => (
                  <div key={item.id} className="flex justify-between gap-4 border-b border-[#f0f0f2] px-5 py-4">
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-semibold">{item.name}</span>
                      <span className="font-mono text-[11px] text-[#71717a]">Qty {item.quantity}</span>
                    </span>
                    <span className="text-sm font-bold">
                      {formatPrice(item.unitPriceCents * item.quantity, order.currency)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between px-5 py-4 text-sm">
                  <span className="text-[#52525b]">Shipping · {shipping === 'express' ? 'Express' : 'Standard'}</span>
                  <span className="font-semibold">{shipping === 'express' ? formatPrice(1200, 'USD') : 'Free'}</span>
                </div>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-semibold uppercase tracking-wide">Due today</span>
                <span className="text-[28px] font-bold tracking-tight">{formatPrice(dueToday, 'USD')}</span>
              </div>
              <p
                className="m-0 px-3.5 py-3 font-mono text-xs"
                style={{ color: '#b3084a', background: '#fff0f5' }}
              >
                {payMode === 'FULL'
                  ? 'The full amount is charged at once. No installment plan is created.'
                  : `3 × ${formatPrice(plan[0], 'USD')} · No interest. The first charge is made when the order is confirmed.`}
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setStep(2)}
                  className="border border-hair px-[22px] py-3.5 text-[13px] font-semibold uppercase tracking-wide text-[#52525b]"
                >
                  Back
                </button>
                <button
                  onClick={() => pay.mutate()}
                  disabled={pay.isPending}
                  className="flex flex-1 items-center justify-center gap-2.5 bg-ink py-4 text-[13px] font-semibold uppercase tracking-[0.1em] text-white disabled:opacity-70"
                >
                  {pay.isPending ? 'Processing…' : 'Pay with Veloce Pay'}
                </button>
              </div>
              {pay.isError && (
                <p className="text-[13px] text-red-600">We couldn&apos;t confirm the order. Please try again.</p>
              )}
            </div>
          )}
        </div>

        <aside className="flex w-full max-w-[300px] flex-col gap-3.5 bg-[#fafafa] p-6">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em]">Summary</span>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-[13px]">
              <span className="text-[#52525b]">Subtotal</span>
              <span className="font-semibold">{formatPrice(order.totalCents, order.currency)}</span>
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="text-[#52525b]">Shipping</span>
              <span className="font-semibold">{shipping === 'express' ? formatPrice(1200, 'USD') : 'Free'}</span>
            </div>
          </div>
          <div className="flex items-baseline justify-between border-t border-hair pt-3.5">
            <span className="text-xs font-semibold uppercase tracking-wide">Total</span>
            <span className="text-[22px] font-bold">{formatPrice(totalCents, 'USD')}</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
