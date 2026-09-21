import { ECOMMERCE_BASE_URL } from './config';
import type { AuthTokens } from './ecommerce-types';
import { useAuthStore } from '@store/auth-store';

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

let refreshPromise: Promise<boolean> | null = null;

// Dedupes concurrent 401s into a single /auth/refresh call — the backend
// revokes the old refresh token on every use, so two parallel refreshes
// with the same token would make the second one fail.
function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = useAuthStore.getState().refreshToken;
      if (!refreshToken) return false;
      try {
        const res = await fetch(`${ECOMMERCE_BASE_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const tokens = (await res.json()) as AuthTokens;
        useAuthStore.getState().setTokens(tokens);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export function createHttpClient(baseUrl: string) {
  function doFetch(path: string, method: string, body: unknown, token: string | null) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  return async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, auth = false } = options;

    let res = await doFetch(path, method, body, auth ? useAuthStore.getState().accessToken : null);

    if (res.status === 401 && auth) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        res = await doFetch(path, method, body, useAuthStore.getState().accessToken);
      }
      if (!refreshed || res.status === 401) {
        useAuthStore.getState().clearAuth();
        throw new Error('Your session expired. Please log in again.');
      }
    }

    if (!res.ok) {
      const message = await res.text().catch(() => res.statusText);
      throw new Error(message || `Request failed with status ${res.status}`);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return (await res.json()) as T;
  };
}
