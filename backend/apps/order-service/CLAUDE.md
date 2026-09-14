# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this service is

`order-service` is one of the independently deployable NestJS microservices of the BNPL system (see the root `README.md`). It owns orders: creation (called synchronously by `cart-service` at checkout), and reacting to payment refunds by marking an order `REFUNDED`. It is the service where the business `transactionId` (as opposed to the request-scoped `correlationId`) is born — see below.

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

`PaymentEventsConsumer` (`src/orders/payment-events.consumer.ts`) subscribes to `payment.transaction.refunded.v1` via `KafkaConsumerService` and calls `OrdersService.markRefunded()`, which is idempotent (a no-op if the order is already `REFUNDED`) and itself writes an outbox `order.order.refunded.v1` event. Errors from `markRefunded` are caught and logged, not rethrown — a missing/already-processed order should not crash the consumer or trigger Kafka's retry/rebalance behavior.
