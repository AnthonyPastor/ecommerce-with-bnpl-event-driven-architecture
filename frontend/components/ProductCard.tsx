'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiClient } from '../lib/api-client';
import { formatPrice } from '../lib/format';
import type { Product } from '../lib/types';
import { useAuthStore } from '../store/auth-store';

export function ProductCard({ product }: { product: Product }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const addToCart = useMutation({
    mutationFn: () => {
      if (!user) throw new Error('not logged in');
      return apiClient.addCartItem({
        userId: user.id,
        productId: product.id,
        name: product.name,
        unitPriceCents: product.priceCents,
        quantity: 1,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cart'] });
    },
  });

  function handleAddToCart() {
    if (!user) {
      router.push('/login');
      return;
    }
    addToCart.mutate();
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex h-40 items-center justify-center bg-gray-100">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt={product.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-sm text-gray-400">No image</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="text-sm font-medium text-gray-900">{product.name}</h3>
        <p className="line-clamp-2 text-xs text-gray-500">{product.description}</p>
        <p className="mt-1 text-base font-semibold text-gray-900">
          {formatPrice(product.priceCents, product.currency)}
        </p>
        <button
          onClick={handleAddToCart}
          disabled={addToCart.isPending}
          className="mt-2 rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {addToCart.isPending ? 'Adding...' : 'Add to cart'}
        </button>
        {addToCart.isError && <p className="text-xs text-red-600">Couldn&apos;t add it</p>}
      </div>
    </div>
  );
}
