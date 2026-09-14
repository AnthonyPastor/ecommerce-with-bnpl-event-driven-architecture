# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this service is

`api-gateway` is the single entry point the `frontend/` talks to (`http://localhost:3000/api/...`). It does three things and nothing else: injects/propagates `x-correlation-id`, verifies JWTs at the edge (so downstream services don't each reimplement auth), and reverse-proxies to the right backend service. It has no database and no business logic.

**Payment gateway webhooks bypass this service entirely** — they hit `payment-service` directly (see that service's CLAUDE.md), since they need a stable public URL and must not require a JWT.

## Commands

Run from `backend/` (the pnpm workspace root):

```bash
pnpm install                          # once
pnpm --filter api-gateway start:dev   # dev server, port 3000 by default
pnpm --filter api-gateway build
pnpm --filter api-gateway test        # unit tests (the auth middleware logic)
```

There is no e2e suite here by design — proxying correctness is exercised by `backend/e2e/` against the real stack, since a gateway-only e2e would just be re-testing `http-proxy-middleware`.

## Architecture

### Not a typical NestJS app internally

`main.ts` creates a NestJS app only to get DI (`ConfigService`, the shared `CorrelationIdMiddleware`) and a pino logger — then it drops to the **raw Express instance** (`app.getHttpAdapter().getInstance()`) and wires `http-proxy-middleware` directly with `expressApp.use(mount, ...)`. There are no controllers. If you need a new proxied route, add it to the `privateProxies` array (or as a bespoke `expressApp.use()` block for something with different auth rules, like `/api/catalog` and `/api/auth`) in `main.ts` — don't reach for `@Controller()`.

### Auth-at-the-edge, not per-service

`createGatewayAuthMiddleware()` (`src/gateway/gateway-auth.middleware.ts`) verifies the JWT (shared `JWT_ACCESS_SECRET` with `auth-service`) and injects `x-user-id` into the proxied request headers, so downstream services *could* trust that header instead of re-verifying — none currently do, but that's the intent. `AUTH_PUBLIC_PATHS` (register/login/refresh) is the one mount with exceptions; every other private mount (`cart`, `orders`, `payments`, `installment-plans`, `notifications`) uses `NO_PUBLIC_PATHS` (empty set — always requires a valid bearer token). `/api/catalog/**` has no auth middleware at all (public browsing).

### Path rewriting depends on whether the target service uses its own prefix

`auth-service` exposes routes under `/auth/...` itself, so its proxy only strips `/api`. `catalog-service` exposes routes "naked" (`/products`, not `/catalog/products`), so its proxy strips `/api/catalog` entirely. `cart-service`/`order-service`/`payment-service`/`bnpl-service`/`notification-service` all expose routes matching their mount segment (`/cart/...`, `/orders/...`, etc.), so they follow the `auth-service` pattern (strip `/api` only). Check the target service's own controller `@Controller()` prefix before assuming which rewrite rule a new proxy needs.
