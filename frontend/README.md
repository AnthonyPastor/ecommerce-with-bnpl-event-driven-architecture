# Frontend

The BNPL system's ecommerce client: catalog, cart, checkout, payment, and installment-plan tracking. This is a **standalone** project (its own `package.json`/lockfile, not part of the `backend/` workspace) that talks to a single backend endpoint, the `api-gateway` — it never calls a microservice directly. See the [root README](../README.md) for the overall context and the [backend README](../backend/README.md) for the event architecture behind each screen.

## Technologies

- **Next.js 14** (App Router)
- **React Query** (`@tanstack/react-query`) — fetching, caching, and polling of async state
- **Zustand** — auth state, persisted to `localStorage`
- **Tailwind CSS**
- **Jest** + Testing Library (jsdom via `next/jest`)

## Getting the environment up

```bash
pnpm install
pnpm dev              # http://localhost:3100 (not 3000 — that port belongs to api-gateway)
```

Needs `api-gateway` (and everything behind it) running and reachable at `NEXT_PUBLIC_API_BASE_URL` (`.env.local`, defaults to `http://localhost:3000/api`) — see [backend/README.md](../backend/README.md) to bring up the full stack.

```bash
pnpm build             # production build
pnpm test              # unit tests
pnpm test -- auth-store.test   # a single file
```

## Architecture

### One API client, no per-feature fetch calls

`lib/api-client.ts` is the only place that talks to the backend. Its internal `request()` helper attaches `Authorization: Bearer` automatically from `useAuthStore.getState().accessToken` when the call passes `auth: true` — components never touch headers by hand. When adding a new backend call, add a method to `apiClient` here, not a loose `fetch` in a component.

### Auth state: Zustand + persist, read imperatively outside components

`store/auth-store.ts` holds `{ accessToken, refreshToken, user }` and persists to `localStorage` (Zustand's `persist` middleware). Components read it reactively with the hook (`useAuthStore((s) => s.user)`); `lib/api-client.ts` reads it *imperatively* via `useAuthStore.getState()` because it isn't a component. `setAuth(tokens, user)` / `clearAuth()` are the only mutators.

### Login has an ordering dependency

In `app/login/page.tsx`, the tokens are written to the store *before* the authenticated `/auth/me` endpoint can be called (the token has to exist in the store first, since `api-client.ts` reads it from there) — then `setAuth` is called again with both tokens and user. If you touch this flow, preserve that ordering.

### Polling async state (payment → capture → installment plan)

The payment is confirmed via an async webhook on the backend (see [backend/README.md § Key flows](../backend/README.md#key-flows)), so the frontend needs to poll until it sees the final state. `app/orders/[id]/page.tsx` is the reference: `refetchInterval` is a function of the last data seen by the query (`query.state.data?.status`), returning `false` once a terminal state is reached and `1000` (ms) otherwise. The installment-plan query is gated on `enabled: isCaptured` and stops polling as soon as it has data (the plan doesn't change state from this UI). Any other UI that needs to "wait for an async backend transition" should copy this pattern rather than inventing a new one.

### Money is always in cents

Every price/amount coming from the backend is `*Cents` (an integer). `lib/format.ts`'s `formatPrice(priceCents, currency)` (divides by 100, formats via a per-currency cached `Intl.NumberFormat`) is the only place that should do that conversion — don't divide by 100 inline elsewhere.

## Pages

| Route | What it does |
|---|---|
| `/` | Product catalog |
| `/login`, `/register` | Authentication |
| `/cart` | View/edit cart, checkout |
| `/orders/[id]` | Payment status (with polling) and, once captured, the resulting installment plan |

More detail in [`CLAUDE.md`](./CLAUDE.md).
