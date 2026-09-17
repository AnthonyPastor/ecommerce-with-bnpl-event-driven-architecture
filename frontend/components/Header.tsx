'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ecommerceApi } from '../lib/ecommerce-api';
import { useAuthStore } from '../store/auth-store';

export function Header() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const clearAuth = useAuthStore((state) => state.clearAuth);

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => ecommerceApi.getCategories(),
    staleTime: 5 * 60 * 1000,
  });

  const cartQuery = useQuery({
    queryKey: ['cart', user?.id],
    queryFn: () => ecommerceApi.getCart(user!.id),
    enabled: !!user,
  });
  const cartCount = cartQuery.data?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  async function handleLogout() {
    try {
      if (refreshToken) {
        await ecommerceApi.logout(refreshToken);
      }
    } catch {
      // logout is best-effort: clear the local session anyway even if the request fails
    } finally {
      clearAuth();
      router.push('/');
    }
  }

  return (
    <>
      <div className="flex items-center justify-center gap-2.5 bg-ink px-5 py-2 text-white">
        <span className="block h-[5px] w-[5px] animate-vpulse rounded-full bg-accent" />
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.1em]">
          We outfit the ones who run, not the ones who watch
        </span>
      </div>

      <header className="sticky top-0 z-20 border-b border-hair bg-white">
        <div className="mx-auto flex h-[68px] max-w-[1280px] items-center gap-7 px-5">
          <Link href="/" className="flex items-baseline gap-[3px]">
            <span className="text-[23px] font-extrabold italic tracking-tight">VELOCE</span>
            <span className="block h-[6px] w-[6px] bg-accent" />
          </Link>

          <nav className="flex flex-1 gap-5 overflow-x-auto">
            {(categoriesQuery.data ?? []).map((category) => (
              <Link
                key={category.id}
                href={`/?category=${category.slug}`}
                className="whitespace-nowrap border-b-2 border-transparent py-1 text-[13px] font-semibold uppercase tracking-wide text-[#52525b] hover:text-ink"
              >
                {category.name}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3.5">
            {user ? (
              <div className="flex items-center gap-3">
                <Link href="/orders" className="text-[13px] font-medium text-[#52525b] hover:text-ink">
                  Orders
                </Link>
                <span className="rounded-sm bg-[#f4f4f5] px-2 py-1 font-mono text-[11px] font-medium text-ink">
                  {user.name.split(' ')[0]}
                </span>
                <button onClick={handleLogout} className="text-xs text-[#52525b] hover:text-ink">
                  Log out
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                className="border border-ink px-3.5 py-[7px] text-xs font-semibold uppercase tracking-wide"
              >
                Log in
              </Link>
            )}
            <Link
              href="/cart"
              className="relative bg-ink px-4 py-[9px] text-xs font-semibold uppercase tracking-wide text-white"
            >
              Cart
              {cartCount > 0 && (
                <span className="absolute -right-[7px] -top-[7px] flex min-w-[19px] items-center justify-center rounded-full bg-accent px-1 font-mono text-[11px] font-semibold leading-[19px] text-ink">
                  {cartCount > 5 ? '+5' : cartCount}
                </span>
              )}
            </Link>
          </div>
        </div>
      </header>
    </>
  );
}
