'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ecommerceApi } from '@lib/ecommerce-api';
import { formatPrice } from '@lib/format';
import { useRequireAuth } from '@lib/use-require-auth';
import { Button } from '@components/Button';

type MutateArgs = { itemId: string; action: 'inc' | 'dec' | 'remove'; quantity: number };

export default function CartPage() {
  const router = useRouter();
  const { user, ready } = useRequireAuth();
  const queryClient = useQueryClient();

  const cartQuery = useQuery({
    queryKey: ['cart', user?.id],
    queryFn: () => ecommerceApi.getCart(user!.id),
    enabled: !!user,
  });

  const mutateItem = useMutation({
    mutationFn: ({ itemId, action, quantity }: MutateArgs) => {
      if (action === 'remove' || quantity <= 0) return ecommerceApi.removeCartItem(user!.id, itemId);
      return ecommerceApi.updateCartItem(user!.id, itemId, quantity);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cart'] }),
  });

  const checkout = useMutation({
    mutationFn: () => ecommerceApi.checkout(user!.id),
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: ['cart'] });
      router.push(`/checkout/${order.id}`);
    },
  });

  if (!ready) return null;

  const items = cartQuery.data?.items ?? [];
  const isBusy = (itemId: string) => mutateItem.isPending && mutateItem.variables?.itemId === itemId;

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 pb-20 pt-10">
      <h1 className="m-0 mb-7 text-[38px] font-bold uppercase leading-none tracking-tight">Your cart</h1>

      {cartQuery.isLoading && (
        <div className="flex flex-col gap-3.5">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-[116px] animate-vshimmer bg-[#f4f4f5]"
              style={{ backgroundImage: 'linear-gradient(90deg, #f4f4f5 0px, #ebebed 160px, #f4f4f5 320px)', backgroundSize: '320px 100%' }}
            />
          ))}
        </div>
      )}

      {cartQuery.isError && <p className="text-sm text-red-600">We couldn&apos;t load your cart.</p>}

      {cartQuery.data && items.length === 0 && (
        <div className="flex flex-col items-center gap-3.5 border border-dashed border-[#d4d4d8] p-16 text-center">
          <span className="font-mono text-[11px] uppercase tracking-wide text-muted">Empty cart</span>
          <p className="m-0 text-2xl font-bold tracking-tight">Nothing here yet</p>
          <p className="m-0 max-w-[380px] text-sm leading-relaxed text-[#71717a]">
            Add a pair from the catalog and it will show up in this summary.
          </p>
          <Button variant="primary" size="md" onClick={() => router.push('/')}>
            Browse catalog
          </Button>
        </div>
      )}

      {cartQuery.data && items.length > 0 && (
        <div className="flex flex-wrap items-start gap-10">
          <div className="flex min-w-[300px] flex-1 basis-[480px] flex-col">
            {items.map((item) => {
              const busy = isBusy(item.id);
              return (
                <div key={item.id} className="flex gap-[18px] border-t border-hair py-5" style={{ opacity: busy ? 0.55 : 1 }}>
                  <div
                    className="h-[120px] w-24 shrink-0 border border-[#f0f0f2]"
                    style={{ backgroundColor: '#ffffff', backgroundImage: 'repeating-linear-gradient(135deg, #fafafa 0 8px, #f2f2f4 8px 16px)' }}
                  />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <button
                      onClick={() => router.push(`/products/${item.productId}`)}
                      className="text-left text-[17px] font-semibold tracking-tight"
                    >
                      {item.name}
                    </button>
                    <span className="font-mono text-xs text-[#71717a]">
                      {item.variantId ? 'Size selected' : 'Size —'}
                    </span>
                    <div className="mt-2.5 flex items-center gap-3.5">
                      <div className="flex items-center border border-hair">
                        <button
                          disabled={busy}
                          onClick={() =>
                            mutateItem.mutate({ itemId: item.id, action: 'dec', quantity: item.quantity - 1 })
                          }
                          className="h-[34px] w-[34px] text-base font-semibold hover:bg-[#f4f4f5]"
                        >
                          –
                        </button>
                        <span className="min-w-[34px] text-center font-mono text-[13px] font-semibold">
                          {item.quantity}
                        </span>
                        <button
                          disabled={busy}
                          onClick={() =>
                            mutateItem.mutate({ itemId: item.id, action: 'inc', quantity: item.quantity + 1 })
                          }
                          className="h-[34px] w-[34px] text-base font-semibold hover:bg-[#f4f4f5]"
                        >
                          +
                        </button>
                      </div>
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() => mutateItem.mutate({ itemId: item.id, action: 'remove', quantity: 0 })}
                      >
                        Remove
                      </Button>
                      {busy && (
                        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-muted">
                          <span className="block h-[11px] w-[11px] animate-vspin rounded-full border-2 border-hair border-t-accent" />
                          Updating
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-right">
                    <span className="text-[17px] font-bold">
                      {formatPrice(item.unitPriceCents * item.quantity, 'USD')}
                    </span>
                    <span className="font-mono text-[11px] text-muted">{formatPrice(item.unitPriceCents, 'USD')} ea.</span>
                  </div>
                </div>
              );
            })}
            <div className="mt-1 border-t border-hair pt-5">
              <Button variant="ghost" onClick={() => router.push('/')}>
                Keep shopping
              </Button>
            </div>
          </div>

          <aside className="sticky top-[92px] flex w-full max-w-[330px] flex-col gap-[18px] border border-hair p-[26px]">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em]">Summary</span>
            <div className="flex flex-col gap-2.5">
              <div className="flex justify-between text-sm">
                <span className="text-[#52525b]">Subtotal</span>
                <span className="font-semibold">{formatPrice(cartQuery.data.totalCents, 'USD')}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#52525b]">Shipping</span>
                <span className="font-semibold">Free</span>
              </div>
            </div>
            <div className="flex items-baseline justify-between border-t border-hair pt-4">
              <span className="text-[13px] font-semibold uppercase tracking-wide">Total</span>
              <span className="text-[26px] font-bold tracking-tight">{formatPrice(cartQuery.data.totalCents, 'USD')}</span>
            </div>
            <Button variant="primary" size="lg" full onClick={() => checkout.mutate()} disabled={checkout.isPending}>
              {checkout.isPending ? 'Processing…' : 'Go to checkout'}
            </Button>
            <span className="text-[11px] leading-relaxed text-muted">
              Continuing creates the order; payment is confirmed in the next step.
            </span>
            {checkout.isError && (
              <p className="text-xs text-red-600">We couldn&apos;t confirm the purchase. Please try again.</p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
