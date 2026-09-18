'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ecommerceApi } from '@lib/ecommerce-api';
import type { PaginatedProducts } from '@lib/ecommerce-types';
import { formatPrice } from '@lib/format';
import { useAuthStore } from '@store/auth-store';
import { Button } from '@components/Button';

const STRIPES = {
  backgroundColor: '#ffffff',
  backgroundImage: 'repeating-linear-gradient(135deg, #fafafa 0 11px, #f2f2f4 11px 22px)',
};

const THUMB_LABELS = ['side', 'sole', 'back', 'detail'];

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [sizeMissing, setSizeMissing] = useState(false);

  function backToCatalog() {
    router.push('/');
  }

  const productQuery = useQuery({
    queryKey: ['product', id],
    queryFn: () => ecommerceApi.getProduct(id),
    staleTime: 5 * 60 * 1000,
    // The catalog list (`GET /products`) and this detail endpoint share the
    // exact same DTO shape (see catalog-service's `toProductDto` — both fetch
    // `relations: { category: true, variants: true }`), so a product already
    // sitting in a cached ['products', ...] list query is a complete, valid
    // seed here: the page renders instantly instead of showing a loading state.
    initialData: () => {
      const cachedLists = queryClient.getQueriesData<PaginatedProducts>({ queryKey: ['products'] });
      for (const [, data] of cachedLists) {
        const match = data?.items.find((p) => p.id === id);
        if (match) return match;
      }
      return undefined;
    },
  });

  const addToCart = useMutation({
    mutationFn: () => {
      if (!user || !productQuery.data) throw new Error('not ready');
      const variant = productQuery.data.variants.find((v) => v.id === selectedVariantId);
      return ecommerceApi.addCartItem({
        userId: user.id,
        productId: productQuery.data.id,
        variantId: variant?.id,
        name: productQuery.data.name,
        unitPriceCents: variant?.priceCents ?? productQuery.data.priceCents,
        quantity: 1,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cart'] }),
  });

  function handleAdd() {
    if (!user) {
      router.push('/login');
      return;
    }
    if (!productQuery.data) return;
    if (productQuery.data.variants.length > 0 && !selectedVariantId) {
      setSizeMissing(true);
      return;
    }
    addToCart.mutate();
  }

  if (productQuery.isLoading) {
    return <div className="mx-auto max-w-[1280px] px-5 py-10 text-sm text-muted">Loading…</div>;
  }
  if (productQuery.isError || !productQuery.data) {
    return <div className="mx-auto max-w-[1280px] px-5 py-10 text-sm text-red-600">Product not found.</div>;
  }

  const product = productQuery.data;

  return (
    <div className="mx-auto w-full max-w-[1280px] px-5 pb-20 pt-6">
      <div className="mb-6">
        <Button variant="ghost" onClick={backToCatalog}>
          ← Catalog
        </Button>
      </div>
      <div className="flex flex-wrap items-start gap-14">
        <div className="flex min-w-[300px] flex-1 basis-[420px] flex-col gap-3">
          <div
            className="relative flex aspect-square items-center justify-center border border-[#f0f0f2]"
            style={STRIPES}
          >
            <span className="whitespace-pre-line text-center font-mono text-[10px] uppercase leading-relaxed tracking-wide text-[#b8b8be]">
              {`product shot · ${product.name.toLowerCase()}\n1:1 · white background`}
            </span>
            {product.isPro && (
              <span className="absolute right-0 top-0 bg-accent px-[7px] py-[5px] font-mono text-[10px] font-semibold uppercase tracking-wide text-ink">
                Pro
              </span>
            )}
          </div>
          <div className="grid grid-cols-4 gap-3">
            {THUMB_LABELS.map((label) => (
              <div
                key={label}
                className="flex aspect-square items-end justify-center border border-[#f0f0f2] pb-1.5"
                style={{ backgroundColor: '#ffffff', backgroundImage: 'repeating-linear-gradient(135deg, #fbfbfb 0 7px, #f4f4f5 7px 14px)' }}
              >
                <span className="font-mono text-[8px] uppercase tracking-wide text-[#c4c4ca]">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-w-[300px] flex-1 basis-[380px] flex-col gap-[22px]">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              {product.category?.name ?? ''}
            </span>
            <h1 className="m-0 text-[40px] font-bold leading-[1.02] tracking-tight">{product.name}</h1>
            <p className="m-0 mt-1 max-w-[460px] text-[15px] leading-relaxed text-[#52525b]">
              {product.description}
            </p>
          </div>
          <div className="flex items-baseline gap-3.5">
            <span className="text-[30px] font-bold tracking-tight">
              {formatPrice(product.priceCents, product.currency)}
            </span>
            <span className="font-mono text-xs tracking-wide text-[#71717a]">Tax included</span>
          </div>

          <div className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Size</span>
              <span className="font-mono text-[11px] text-[#71717a]">Sold-out sizes struck through</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {product.variants.map((variant) => {
                const out = variant.stock === 0;
                const on = selectedVariantId === variant.id;
                return (
                  <button
                    key={variant.id}
                    disabled={out}
                    onClick={() => {
                      setSelectedVariantId(variant.id);
                      setSizeMissing(false);
                    }}
                    className={`min-w-[62px] border px-2 py-[11px] font-mono text-xs font-semibold tracking-wide ${
                      out
                        ? 'border-[#f0f0f2] text-[#d4d4d8] line-through'
                        : on
                          ? 'border-ink bg-ink text-white'
                          : 'border-hair bg-white text-ink'
                    }`}
                  >
                    {variant.name}
                  </button>
                );
              })}
            </div>
            {sizeMissing && <span className="text-xs text-red-600">Pick a size to continue.</span>}
          </div>

          <Button variant="primary" size="lg" full onClick={handleAdd} disabled={addToCart.isPending}>
            {addToCart.isPending
              ? 'Adding…'
              : `Add · ${formatPrice(product.priceCents, product.currency)}`}
          </Button>

          <ul className="m-0 flex list-none flex-col gap-2.5 border-t border-hair pt-[18px]">
            <li className="flex justify-between text-sm">
              <span className="text-[#71717a]">Category</span>
              <span className="font-medium">{product.category?.name ?? ''}</span>
            </li>
            <li className="flex justify-between text-sm">
              <span className="text-[#71717a]">Shipping</span>
              <span className="font-medium">Free standard · 3-5 days</span>
            </li>
            <li className="flex justify-between text-sm">
              <span className="text-[#71717a]">Returns</span>
              <span className="font-medium">30 days</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
