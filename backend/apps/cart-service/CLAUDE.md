# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this service is

`cart-service` is one of the independently deployable NestJS microservices of the BNPL system (see the root `README.md`). It owns the shopping cart: one `ACTIVE` cart per user, items with a price snapshot taken at add-time, and the checkout step that hands off to `order-service`.

## Commands

Run from `backend/` (the pnpm workspace root):

```bash
pnpm install                              # once
pnpm --filter cart-service start:dev      # dev server, port 3003 by default
pnpm --filter cart-service build
pnpm --filter cart-service test           # unit tests
pnpm --filter cart-service test -- cart.service.spec   # single file
pnpm --filter cart-service test:e2e       # needs Postgres up, cart_db created
```

Local infra: `docker compose -f backend/infra/docker-compose.yml up -d`. Checkout also needs `order-service` reachable at `ORDER_SERVICE_URL` (see `.env.example`) — the e2e suite's checkout test is `it.skip`ped for that reason; it's covered by the system suite in `backend/e2e/` instead.

## Architecture

- `Cart.status` is `'ACTIVE' | 'CHECKED_OUT'` — `GET /cart?userId=` lazily creates an empty `ACTIVE` cart if the user has none (never 404s). After checkout, the cart is marked `CHECKED_OUT` and the next `GET /cart` for that user creates a fresh `ACTIVE` one.
- `POST /cart/items` matches on `productId` + `variantId` (normalized `?? null`) to decide whether to increment an existing line or add a new one.
- **Checkout is a synchronous HTTP call, not an event.** `CartService.checkout()` uses `PropagatingHttpService` (from `@bnpl/observability`) to `POST` to `order-service`'s `/orders` — that wrapper automatically forwards `x-correlation-id`/`x-transaction-id` from the current request context, so you never set those headers by hand. The response from `order-service` is returned to the caller as-is (passthrough), and only on success is the cart flipped to `CHECKED_OUT`.
- No outbox/Kafka here — cart-service is intentionally the one checkout-adjacent service that doesn't publish domain events in this skeleton (see root plan notes on `cart.cart.checked_out.v1` being deferred).
