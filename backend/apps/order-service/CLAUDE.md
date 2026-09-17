# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this service is

`order-service` is one of the independently deployable NestJS microservices of the BNPL system (see the root `README.md`). It owns orders: creation (called synchronously by `cart-service` at checkout), and reacting to payment-service's events — confirming an order once its payment captures, marking it `REFUNDED` on a full refund, and mirroring dispute/chargeback/partial-refund signals onto it in between. It is the service where the business `transactionId` (as opposed to the request-scoped `correlationId`) is born — see below.

## Commands

Run from `backend/` (the pnpm workspace root):

```bash
pnpm install                               # once
pnpm --filter order-service start:dev      # dev server, port 3004 by default
pnpm --filter order-service build
pnpm --filter order-service test           # unit tests
pnpm --filter order-service test -- orders.service.spec   # single file
pnpm --filter order-service test:e2e       # needs Postgres + Kafka up, order_db created
```

Local infra: `docker compose -f backend/infra/docker-compose.yml up -d` (needs Postgres and Kafka; this service both produces to and consumes from Kafka).

## Architecture

### Outbox pattern (the reference implementation to copy)

`OrdersService.createOrder()` (`src/orders/orders.service.ts`) is the canonical example of the transactional outbox pattern used across this monorepo. It:
1. Generates the `Order.id` **client-side** with `randomUUID()` before any save — needed because that id is used as `aggregateId` for the outbox event in the same call.
2. Opens a `DataSource.createQueryRunner()` transaction.
3. Calls `saveWithOutbox()` (from `@bnpl/outbox`) which saves the domain entity (`Order`) and an `outbox_event` row atomically — either both persist or neither does.
4. Commits, then calls `requestContext.setTransactionId(order.id)` so the rest of the request's logs carry it.

`@bnpl/outbox`'s `OutboxPublisherService` (registered via `OutboxModule.forFeature({ producerName: 'order-service' })` in `orders.module.ts`) polls unpublished rows on an interval and publishes them to Kafka via `@bnpl/kafka-client` — this is decoupled from the HTTP request entirely.

### The business `transactionId` vs. request `correlationId`

`order.id` becomes the envelope's `transactionId` for every event related to this order, across every service that reacts to it (payment-service, bnpl-service). This is distinct from `correlationId`, which is per-HTTP-request. A webhook arriving later on payment-service is a *new* HTTP request (new correlationId) but must recover the *same* transactionId by looking up the order/transaction — see `payment-service`'s `CLAUDE.md`.

### Reacting to payment events

`PaymentEventsConsumer` (`src/orders/payment-events.consumer.ts`) subscribes to five topics from payment-service and routes each to a matching `OrdersService` method. Errors from any of them are caught and logged, not rethrown — a missing/already-processed order should not crash the consumer or trigger Kafka's retry/rebalance behavior.

- `payment.transaction.captured.v1` → `markConfirmed(orderId, paymentMethod)`: CREATED → CONFIRMED, idempotent (no-op once already past CREATED), takes a `pessimistic_write` row lock on the SELECT so an at-least-once duplicate delivery can't race a still-in-flight call into double-confirming. `paymentMethod` normally comes straight from the payload (payment-service's `Transaction.paymentMethod` is NOT NULL); a missing value is treated as a schema-drift edge case and defaults to `INSTALLMENTS` with a warning log, not silently trusted.
- `payment.transaction.refunded.v1` (full refund) → `markRefunded(orderId)`: → `REFUNDED`, idempotent, also clears any `paymentIncident` (a full refund supersedes a prior dispute/chargeback/partial-refund signal). Same `pessimistic_write` locking as `markConfirmed`.
- `payment.transaction.partially_refunded.v1` / `.dispute_opened.v1` / `.chargeback_received.v1` → `markPaymentIncident(orderId, 'PARTIALLY_REFUNDED' | 'DISPUTED' | 'CHARGEBACK')`: mirrors the signal onto `Order.paymentIncident` (a plain idempotent `update`, no outbox event — nothing else reacts to order-service's own copy, only to payment-service's original topics, see that service's CLAUDE.md).

### Computed `paymentStatus` incorporates `paymentIncident`

`paymentStatusFor()` (`src/orders/orders.service.ts`) checks `order.paymentIncident` first (`PARTIALLY_REFUNDED`/`DISPUTED`/`CHARGEBACK` short-circuit straight through) and only falls back to the `status`/`paymentMethod`-derived `UNPAID`/`PAID`/`INSTALLMENTS_PENDING` split when there's no incident recorded — payment state keeps moving after `CONFIRMED` (a capture can later be disputed or partially refunded) and `Order.status` alone can't reflect that.
