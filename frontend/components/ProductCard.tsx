'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ecommerceApi } from '../lib/ecommerce-api';
import { formatPrice } from '../lib/format';
import type { Product } from '../lib/ecommerce-types';
import { useAuthStore } from '../store/auth-store';

const STRIPES = {
  backgroundColor: '#ffffff',
  backgroundImage: 'repeating-linear-gradient(135deg, #fafafa 0 9px, #f2f2f4 9px 18px)',
};

export function ProductCard({ product }: { product: Product }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const addToCart = useMutation({
    mutationFn: () => {
      if (!user) throw new Error('not logged in');
      return ecommerceApi.addCartItem({
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
    <div className="flex animate-vrise flex-col">
      <button
        onClick={() => router.push(`/products/${product.id}`)}
        className="relative block w-full border border-white bg-white p-0"
      >
        <div className="flex aspect-[4/5] items-center justify-center" style={STRIPES}>
          <span className="whitespace-pre-line px-3 text-center font-mono text-[9px] uppercase leading-relaxed tracking-wide text-[#b8b8be]">
            {`product shot\n${product.name.toLowerCase()}\nwhite bg`}
          </span>
        </div>
        {product.isPro && (
          <span className="absolute right-0 top-0 bg-accent px-[7px] py-[5px] font-mono text-[10px] font-semibold uppercase tracking-wide text-ink">
            Pro
          </span>
        )}
      </button>
      <div className="flex flex-col gap-1 pt-3.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted">
          {product.category?.name ?? ''}
        </span>
        <button
          onClick={() => router.push(`/products/${product.id}`)}
          className="text-left text-[15px] font-semibold tracking-tight"
        >
          {product.name}
        </button>
        <div className="mt-0.5 flex items-baseline gap-2.5">
          <span className="text-[15px] font-bold">{formatPrice(product.priceCents, product.currency)}</span>
        </div>
        <button
          onClick={handleAddToCart}
          disabled={addToCart.isPending}
          className="mt-2.5 border border-ink bg-white py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink hover:bg-ink hover:text-white disabled:bg-[#f4f4f5] disabled:text-muted"
        >
          {addToCart.isPending ? 'Adding…' : 'Add'}
        </button>
        {addToCart.isError && <p className="text-xs text-red-600">Couldn&apos;t add it</p>}
      </div>
    </div>
  );
}
