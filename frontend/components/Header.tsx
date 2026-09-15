'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '../lib/api-client';
import { useAuthStore } from '../store/auth-store';

export function Header() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const clearAuth = useAuthStore((state) => state.clearAuth);

  async function handleLogout() {
    try {
      if (refreshToken) {
        await apiClient.logout(refreshToken);
      }
    } catch {
      // logout is best-effort: clear the local session anyway even if the request fails
    } finally {
      clearAuth();
      router.push('/');
    }
  }

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Link href="/" className="text-lg font-semibold text-gray-900">
          BNPL Store
        </Link>
        {user ? (
          <div className="flex items-center gap-4">
            <Link href="/cart" className="text-sm text-gray-600 hover:text-gray-900">
              Cart
            </Link>
            <span className="text-sm text-gray-600">Hi, {user.name}</span>
            <button
              onClick={handleLogout}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700"
            >
              Log out
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700"
          >
            Log in
          </Link>
        )}
      </div>
    </header>
  );
}
