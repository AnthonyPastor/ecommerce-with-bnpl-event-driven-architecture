# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A BNPL (buy now, pay later) ecommerce system built as a learning/skeleton project to exercise event-driven microservices patterns end-to-end: event-driven architecture (Kafka + RabbitMQ), the transactional outbox pattern, the repository pattern for swappable external providers (payment gateway, email, auth tokens), async webhook handling with proper state machines, and correlation/transaction-id propagation across service boundaries. See `README.md` for the full write-up, `backend/README.md` for the event catalog and key flows, and `frontend/README.md` for the client app.

## Repository layout

```
frontend/    Standalone Next.js app — its own package.json/lockfile, not part of the backend workspace
backend/     pnpm workspace — apps/* (8 NestJS microservices + api-gateway), packages/* (shared libs), e2e/ (cross-service suite), infra/ (docker-compose)
```

`frontend/` and `backend/` are **independent projects on purpose** — install and run each separately. Every folder under `backend/apps/` is designed to be extractable to its own repository later (this repo is the "guide" for running the whole system together during development). Each of the 9 project folders (`frontend/`, `backend/`, and every service under `backend/apps/`) has its own `CLAUDE.md` with folder-specific detail — read the relevant one before working inside it. This root file only covers cross-cutting, system-wide concerns.

## Commands

There is no root-level build/test — always work from `frontend/` or `backend/` (or a specific `backend/apps/<service>` via `pnpm --filter`). See `backend/README.md` and `frontend/README.md` for the full command reference and `backend/e2e/` for the cross-service suite.

```bash
# infra (Postgres, Kafka, RabbitMQ, Redis, Adminer)
cd backend && pnpm infra:up      # / infra:down

# everything else — see backend/README.md and frontend/README.md
```

## Architecture (system-wide)

### Nine independent projects, one gateway

`frontend/` never talks to an individual microservice — it only calls `api-gateway` (port 3000), which verifies JWTs at the edge and reverse-proxies to `auth-service`, `catalog-service`, `cart-service`, `order-service`, `payment-service`, `bnpl-service`, `notification-service`. Payment-gateway webhooks are the one exception: they hit `payment-service` directly, bypassing the gateway, since they need a stable public URL and no JWT. See `backend/apps/api-gateway/CLAUDE.md`.

### Two event systems, deliberately different guarantees

- **Kafka** — immutable domain-event log / audit trail (`<domain>.<entity>.<event>.v1` topics, e.g. `payment.transaction.captured.v1`). Written via the **transactional outbox pattern** (`@bnpl/outbox`): the domain row and the outbox row are saved in the same DB transaction, then `OutboxPublisherService` polls and publishes asynchronously — so a service never has a half-committed state where the DB says one thing and Kafka says another. `order-service`'s `OrdersService.createOrder()` is the reference implementation to copy for any new event-producing flow.
- **RabbitMQ** — point-to-point commands/tasks that need retry + DLQ (email sending, webhook processing, installment charging), via `@bnpl/rabbitmq-client`'s `bindRetryTopology()` (main queue → `retry.<queue>` with TTL → dead-letters back to main; `dlq.<queue>` after max attempts).

Full event/queue catalog: `backend/packages/event-contracts/src/topics.ts`. Full per-flow detail (who publishes, who consumes, why): `backend/README.md`.

### Correlation ID vs. transaction ID

Every HTTP request gets a `correlationId` (via `CorrelationIdMiddleware` from `@bnpl/observability`, stored in an `AsyncLocalStorage`-backed `RequestContextService`, auto-stamped onto every log line and auto-propagated on outbound HTTP/Kafka/RabbitMQ headers — never thread it through method signatures by hand). A `transactionId` is different: it identifies one *business* flow (almost always `order.id`) and survives across otherwise-unrelated HTTP requests — e.g. a payment-gateway webhook is a brand-new request with its own `correlationId`, but `payment-service` recovers the same `transactionId` by looking up the order/transaction row, never from an inbound header. See `backend/apps/order-service/CLAUDE.md` and `backend/apps/payment-service/CLAUDE.md` for where each id is born/recovered.

### Repository pattern for every external integration

Payment gateway (`PaymentGatewayPort`, payment-service), email (`EmailProviderPort`, notification-service), and auth tokens (`TokenProviderPort`, auth-service) are each an abstract class + a DI token, with a fake/stub implementation selected by an env var factory. Swapping in MercadoPago/SendGrid/Auth0 later means adding one new class that implements the same port — no consumer code changes. Follow this pattern for any new external dependency.

### The payment state machine

`PAYMENT_TRANSITIONS` (`backend/packages/event-contracts/src/enums.ts`) is the single source of truth for valid `Transaction` status transitions (authorize → capture → refund/void/dispute/chargeback), shared by `payment-service`'s `assertTransition()`. See `backend/apps/payment-service/CLAUDE.md` for the full diagram and the async-webhook pipeline built around it.

### TypeORM gotcha that recurs across every service

Any `string | null` (or other nullable) column needs an explicit `type: 'varchar'` (or the right PG type) in its `@Column()` decorator — without it, `reflect-metadata` infers `Object` and Postgres `synchronize: true` fails with `DataTypeNotSupportedError` at bootstrap. All entities in this repo already follow this; keep doing so for new ones.
