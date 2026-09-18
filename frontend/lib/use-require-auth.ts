'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuthStore } from '@store/auth-store';

/**
 * Guards a client page behind auth. Redirects to /login once the persisted
 * session has actually finished loading and there's still no user — never
 * on the pre-hydration tick, where `user` reads `null` for one render even
 * with a valid session sitting in localStorage (zustand's `persist` reads
 * it back in asynchronously after a hard page load).
 */
export function useRequireAuth() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);

  useEffect(() => {
    if (hasHydrated && !user) {
      router.replace('/login');
    }
  }, [hasHydrated, user, router]);

  return { user, ready: hasHydrated && !!user };
}
