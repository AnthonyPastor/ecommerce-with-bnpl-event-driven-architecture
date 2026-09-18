# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The customer-facing ecommerce frontend for the BNPL system — Next.js 14 (App Router), React Query, Zustand, Tailwind. It is a **standalone project**, not part of the `backend/` pnpm workspace (its own `package.json`/lockfile) — see the root `README.md` for why. It talks to exactly one backend URL: the `api-gateway`, never an individual microservice directly.

Covers the full happy path end-to-end: browse catalog → add to cart → view/edit cart → checkout (creates an order) → pay → poll payment status until captured → view the resulting installment plan.

## Commands

Run from this directory:

```bash
pnpm install
pnpm dev              # dev server on port 3100 (not 3000 — api-gateway owns 3000)
pnpm build             # production build (next build)
pnpm test              # jest (jsdom via next/jest)
pnpm test -- auth-store.test    # single file
```

Needs `api-gateway` (and everything behind it) running and reachable at `NEXT_PUBLIC_API_BASE_URL` (`.env.local`, defaults to `http://localhost:3000/api`).

## Architecture

### Two thin API clients over one shared HTTP core, no per-feature fetch calls

`lib/http.ts`'s `createHttpClient(baseUrl)` is the shared `request()` factory: it attaches `Authorization: Bearer` automatically from `useAuthStore.getState().accessToken` when a call passes `auth: true`, and transparently retries once on a 401 by deduping concurrent calls into a single `/auth/refresh` (the backend revokes the old refresh token on every use, so two parallel refreshes with the same token would otherwise race). `lib/ecommerce-api.ts` (`ecommerceApi`, base `NEXT_PUBLIC_API_BASE_URL`) covers auth/catalog/cart/orders; `lib/bnpl-api.ts` (`bnplApi`, base `NEXT_PUBLIC_BNPL_API_BASE_URL`, defaults to the same URL) covers payments/installment-plans — both go through `api-gateway`, the split is purely to keep each file scoped to one domain. When adding a new backend call, add a method to the matching client rather than calling `fetch` from a component.

### Auth state: Zustand + persist, read imperatively outside components

`store/auth-store.ts` holds `{ accessToken, refreshToken, user }` and persists to `localStorage` (`zustand/middleware`'s `persist`). Components read it reactively via the hook (`useAuthStore((s) => s.user)`); `lib/http.ts` reads it *imperatively* via `useAuthStore.getState()` since it's not a component. `setAuth(tokens, user)` / `setTokens(tokens)` (refresh only, keeps `user` as-is) / `clearAuth()` are the only mutators.

### Login flow has an ordering dependency

`app/login/page.tsx`: tokens are written to the store *before* the app can call the authenticated `/auth/me` endpoint to fetch the user object (the token has to exist in the store first, since `lib/http.ts` reads it from there) — then `setAuth` is called again with both tokens and user. If you touch this flow, preserve that ordering.

### Payment status polling pattern

`app/orders/[id]/page.tsx` is the reference for polling an async backend state machine from React Query: `refetchInterval` is a function of the query's own last-seen data (`query.state.data?.status`), returning `false` once a `TERMINAL_PAYMENT_STATUSES` (`lib/bnpl-types.ts`) value is reached and `1000` (ms) otherwise. The installment-plan query is gated on `enabled: isCaptured` and stops polling once data exists (installment plans don't change status from this UI). Copy this pattern for any other "wait for an async backend transition" UI rather than inventing a new one.

### A checkout must never re-render over an order that already has a live payment

`payment-service`'s `POST /payments` guard rejects a second attempt for any order whose latest transaction isn't terminal (see `PAYMENT_TRANSITIONS`/`NON_BLOCKING_PAYMENT_STATUSES` in `lib/bnpl-types.ts`, mirrored from that service's own `isTerminalPaymentStatus`) — so `app/checkout/[orderId]/page.tsx` fetches the order's latest transaction via `bnplApi.getPaymentByOrderId` before rendering the wizard, and redirects to `/orders/[id]?tx=<id>` (to resume polling) whenever one is found in a blocking status, on top of the existing bounce for an already-`CONFIRMED` order. If you add a new entry point into checkout, route through this same order id so the guard applies — don't let a component reach the wizard from a captured or in-flight order id.

### Shared `Button` component mirrors the Claude Design system

`components/Button.tsx` ports `Button.dc.html` from the "Sistema de diseño frontend reutilizable" Claude Design project 1:1 — same 4 variants (`primary`/`outline`/`ghost`/`danger`) x 4 sizes (`xs`/`sm`/`md`/`lg`), same disabled treatment (dim to 55% opacity rather than a per-usage disabled color). `ghost` and `danger` ignore `size` (fixed, small typography) exactly like the source component. Use it for any actionable button instead of hand-rolling Tailwind classes, so the four variants stay pixel-consistent across the app; `buttonClasses(variant, size, full, disabled)` is exported separately for a non-`<button>` element that needs to look like one.

**Don't trust a `.dc.html` prop literally — check what it actually renders.** `ProductCard.dc.html` passes `full={true}` to its "Add" button, but that button's host wrapper sits inside a row flexbox that doesn't stretch it, so the real rendered button (verified via `render_preview` against the live Claude Design project, not just the markup) is content-sized, not full-width. `components/ProductCard.tsx` intentionally omits `full` to match. When porting a design file, render it and compare pixels — the source markup's literal props can be misleading.

### A page that must fill the screen needs `main` to be a flex column, and `w-full` on the page root

`app/layout.tsx`'s `<main>` is `flex min-h-0 flex-1 flex-col` (not just `flex-1`) so a page like `app/login/page.tsx` — whose root is `flex-1` itself — can actually stretch to fill the remaining viewport height below the header and above the footer, matching the Claude Design prototype's own `<main style="flex:1; display:flex; flex-direction:column; min-height:0">`. A plain block `<main>` only gives a flex-item *height* your page can't reach with `h-full`/percentage sizing in practice (percentage heights don't reliably resolve against a flex-grow-derived height one level up) — making `main` itself `flex-col` is the fix, not a taller `min-h-[...]` guess.

That change has a real side effect: every direct page root becomes a flex item of a column container, and `align-items: stretch` (the flex default) can produce a **narrower-than-expected width** for a page root that contains its own nested `flex flex-wrap` row with `flex-1 basis-[Npx]` children (seen on `products/[id]`, `cart`, `checkout` — image/summary two-column layouts) — the stretch sizing pass can resolve to a content-fit width instead of the container's full width in that specific combination. The fix is to make the page root's width explicit rather than relying on stretch: every page root in `app/*/page.tsx` carries a `w-full` class alongside its `mx-auto max-w-[...]`. Keep doing this for any new full-width page — dropping `w-full` reproduces the bug.

### Catalog/product data is cached — it doesn't change during a session

`app/providers.tsx`'s `QueryClient` sets a 1-minute default `staleTime` for every query; `app/page.tsx`'s products/categories queries and `app/products/[id]/page.tsx`'s product query go further with 5 minutes, since the catalog is effectively static here (no admin UI, no write path). `products/[id]/page.tsx` also seeds its query's `initialData` from any already-cached `['products', ...]` list query — catalog-service's list and detail endpoints return the identical DTO shape (see `catalog-service`'s `toProductDto`), so a product a `ProductCard` was clicked from renders instantly instead of showing a loading state, which incidentally is also what makes the `product-media` view transition have something to morph into on the very first paint. Queries that must stay fresh (payment/order status) already override this per-query with `refetchInterval` — don't lower the global default to "fix" a page that actually needs live data, scope the override to that query instead.

### Money is always in cents

Every price/amount from the backend is `*Cents` (integer). `lib/format.ts`'s `formatPrice(priceCents, currency)` (divides by 100, formats via cached `Intl.NumberFormat` per currency, locale `en-US`) is the only place that should do that conversion — don't `/ 100` inline elsewhere.
