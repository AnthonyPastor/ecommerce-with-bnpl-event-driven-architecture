'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { apiClient } from '../../lib/api-client';
import { formatPrice } from '../../lib/format';
import { useAuthStore } from '../../store/auth-store';

export default function CartPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user) router.replace('/login');
  }, [user, router]);

  const cartQuery = useQuery({
    queryKey: ['cart', user?.id],
    queryFn: () => apiClient.getCart(user!.id),
    enabled: !!user,
  });

  const removeItem = useMutation({
    mutationFn: (itemId: string) => apiClient.removeCartItem(user!.id, itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cart'] }),
  });

  const checkout = useMutation({
    mutationFn: () => apiClient.checkout(user!.id),
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: ['cart'] });
      router.push(`/orders/${order.id}`);
    },
  });

  if (!user) return null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold text-gray-900">Your cart</h1>

      {cartQuery.isLoading && <p className="text-sm text-gray-500">Loading...</p>}
      {cartQuery.isError && <p className="text-sm text-red-600">We couldn&apos;t load your cart.</p>}

      {cartQuery.data && cartQuery.data.items.length === 0 && (
        <p className="text-sm text-gray-500">Your cart is empty.</p>
      )}

      {cartQuery.data && cartQuery.data.items.length > 0 && (
        <div className="flex flex-col gap-4">
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {cartQuery.data.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-4 p-4">
                <div>
                  <p className="text-sm font-medium text-gray-900">{item.name}</p>
                  <p className="text-xs text-gray-500">
                    {item.quantity} x {formatPrice(item.unitPriceCents, 'USD')}
                  </p>
                </div>
                <button
                  onClick={() => removeItem.mutate(item.id)}
                  disabled={removeItem.isPending}
                  className="text-xs text-red-600 hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
            <span className="text-sm font-medium text-gray-900">Total</span>
            <span className="text-lg font-semibold text-gray-900">
              {formatPrice(cartQuery.data.totalCents, 'USD')}
            </span>
          </div>

          <button
            onClick={() => checkout.mutate()}
            disabled={checkout.isPending}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {checkout.isPending ? 'Processing...' : 'Confirm purchase'}
          </button>
          {checkout.isError && (
            <p className="text-sm text-red-600">We couldn&apos;t confirm the purchase. Please try again.</p>
          )}
        </div>
      )}
    </main>
  );
}
