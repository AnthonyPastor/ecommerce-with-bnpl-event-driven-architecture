'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { ProductCard } from '@components/ProductCard';
import { Button } from '@components/Button';
import { ecommerceApi } from '@lib/ecommerce-api';

type SortKey = 'featured' | 'priceAsc' | 'priceDesc';

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const categorySlug = searchParams.get('category');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('featured');

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => ecommerceApi.getCategories(),
    staleTime: 5 * 60 * 1000,
  });

  const activeCategory = categoriesQuery.data?.find((c) => c.slug === categorySlug) ?? null;

  const productsQuery = useQuery({
    queryKey: ['products', activeCategory?.id ?? 'all'],
    queryFn: () => ecommerceApi.getProducts({ page: 1, pageSize: 100, categoryId: activeCategory?.id }),
    enabled: !categorySlug || !!activeCategory,
    staleTime: 5 * 60 * 1000,
  });

  const visibleProducts = useMemo(() => {
    const items = productsQuery.data?.items ?? [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? items.filter(
          (p) => p.name.toLowerCase().includes(q) || (p.category?.name.toLowerCase().includes(q) ?? false),
        )
      : items;
    if (sort === 'priceAsc') return [...filtered].sort((a, b) => a.priceCents - b.priceCents);
    if (sort === 'priceDesc') return [...filtered].sort((a, b) => b.priceCents - a.priceCents);
    return filtered;
  }, [productsQuery.data, query, sort]);

  const total = productsQuery.data?.items.length ?? 0;

  return (
    <div>
      <div className="relative overflow-hidden bg-ink text-white">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'repeating-linear-gradient(115deg, rgba(255,45,111,.22) 0 2px, transparent 2px 26px)',
          }}
        />
        <div className="relative mx-auto flex max-w-[1280px] flex-wrap items-end justify-between gap-8 px-5 py-14 sm:py-16">
          <div className="max-w-[640px]">
            <div className="mb-[18px] font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-accent">
              Current collection
            </div>
            <h1 className="m-0 text-5xl font-extrabold italic uppercase leading-[0.92] tracking-tight sm:text-[68px]">
              Speed you pay in three
            </h1>
            <p className="mt-5 max-w-[440px] text-base leading-relaxed text-[#d4d4d8]">
              Running, trail and court. Pick your pair today, split it into three equal charges, keep training.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="border border-[#3f3f46] px-3.5 py-3 font-mono text-[13px] font-semibold tracking-wide text-white">
              Free standard shipping
            </span>
            <span className="bg-accent px-3.5 py-3 font-mono text-[13px] font-semibold tracking-wide text-ink">
              0% interest
            </span>
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-start gap-10 px-5 py-8 pb-16">
        <aside className="sticky top-[92px] w-[216px] shrink-0">
          <div className="flex flex-col gap-7">
            <div className="flex flex-col gap-2.5">
              <label className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
                Search
              </label>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Model or category"
                className="w-full border border-hair px-3 py-2.5 text-sm outline-none focus:border-ink"
              />
            </div>
            <div className="flex flex-col gap-2.5">
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
                Category
              </span>
              <button
                onClick={() => router.push('/')}
                className={`flex items-center justify-between py-1.5 text-left text-sm ${!categorySlug ? 'font-semibold text-ink' : 'font-normal text-[#52525b]'}`}
              >
                <span>All</span>
              </button>
              {(categoriesQuery.data ?? []).map((c) => (
                <button
                  key={c.id}
                  onClick={() => router.push(`/?category=${c.slug}`)}
                  className={`flex items-center justify-between py-1.5 text-left text-sm ${categorySlug === c.slug ? 'font-semibold text-ink' : 'font-normal text-[#52525b]'}`}
                >
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2.5">
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">Sort</span>
              {(
                [
                  ['featured', 'Featured'],
                  ['priceAsc', 'Price: low to high'],
                  ['priceDesc', 'Price: high to low'],
                ] as [SortKey, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setSort(key)}
                  className={`py-1.5 text-left text-sm ${sort === key ? 'font-semibold text-ink' : 'font-normal text-[#52525b]'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <div className="flex min-w-[320px] flex-1 flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <h2 className="m-0 text-[34px] font-bold uppercase leading-none tracking-tight">
                {activeCategory ? activeCategory.name : "For those who don't slow down"}
              </h2>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-wide text-muted">
                {productsQuery.data ? `${visibleProducts.length} models` : '—'}
              </p>
            </div>
          </div>

          {productsQuery.isLoading && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-6">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="flex flex-col gap-3">
                  <div className="aspect-[4/5] animate-vshimmer bg-[#f4f4f5]" style={{ backgroundImage: 'linear-gradient(90deg, #f4f4f5 0px, #ebebed 160px, #f4f4f5 320px)', backgroundSize: '320px 100%' }} />
                  <div className="h-3 w-[70%] bg-[#f4f4f5]" />
                  <div className="h-3 w-[35%] bg-[#f4f4f5]" />
                </div>
              ))}
            </div>
          )}

          {productsQuery.isError && (
            <div className="flex flex-col items-start gap-3 border border-hair border-l-[3px] border-l-red-600 p-7">
              <span className="font-mono text-[11px] uppercase tracking-wide text-red-600">
                ERR_CATALOG_UNAVAILABLE
              </span>
              <p className="m-0 text-[17px] font-semibold">We couldn&apos;t load the catalog</p>
              <p className="m-0 max-w-[460px] text-sm leading-relaxed text-[#71717a]">
                The catalog did not respond. Try again; if it persists, check the api-gateway status.
              </p>
              <Button variant="primary" size="md" onClick={() => productsQuery.refetch()}>
                Try again
              </Button>
            </div>
          )}

          {productsQuery.data && total > 0 && visibleProducts.length === 0 && (
            <div className="flex flex-col items-center gap-3 border border-dashed border-[#d4d4d8] p-14 text-center">
              <span className="font-mono text-[11px] uppercase tracking-wide text-muted">No results</span>
              <p className="m-0 text-xl font-semibold tracking-tight">
                {query ? `«${query}»` : activeCategory?.name}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery('');
                  router.push('/');
                }}
              >
                Clear filters
              </Button>
            </div>
          )}

          {productsQuery.data && visibleProducts.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(236px,1fr))] gap-6">
              {visibleProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
