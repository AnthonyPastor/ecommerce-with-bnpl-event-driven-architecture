# Backend

Backend of the BNPL system: 8 independent NestJS microservices + an API
gateway, coordinated via events (Kafka) and commands (RabbitMQ), each with
its own PostgreSQL database. See the [root README](../README.md) for the
overall project context and the [frontend README](../frontend/README.md) for
the client.

## Technologies

- **NestJS** (one per microservice, `pnpm` workspace with `apps/*` + `packages/*`)
- **PostgreSQL 16** — one database per service (except `api-gateway`, which is stateless)
- **Apache Kafka 3.8.0** in **KRaft** mode (no Zookeeper) — immutable domain events
- **RabbitMQ 3** — point-to-point commands/tasks with retry + dead-letter queue
- **Redis** — reserved for infrastructure (cache/rate-limit), not yet in critical use
- **TypeORM** (`synchronize: true`, no migrations — this is a learning project, not production)
- **nestjs-pino** for structured logging, with correlation/transaction id auto-injected
- **Jest** (unit per service + e2e per service + cross-service e2e suite)
- **Docker Compose** for all local infra

## Microservices

| Service | Port | Database | Responsibility |
|---|---|---|---|
| `api-gateway` | 3000 | — | The frontend's single entry point. Verifies JWTs, adds/propagates `x-correlation-id`, reverse-proxies. No business logic. |
| `auth-service` | 3001 | `auth_db` | Identity: registration, login, JWT access/refresh, session revocation. |
| `catalog-service` | 3002 | `catalog_db` | Catalog: categories, products, variants. Read-only for the rest of the system. |
| `cart-service` | 3003 | `cart_db` | Shopping cart and checkout (synchronous call to `order-service`). |
| `order-service` | 3004 | `order_db` | Orders: creation, and reacting to payment-service's events (confirms, cancels, refunds, mirrors dispute/chargeback/partial-refund status). This is where the business `transactionId` is born. |
| `payment-service` | 3005 | `payment_db` | Payment state machine, gateway abstraction, async webhook pipeline. The most complex service. |
| `bnpl-service` | 3006 | `bnpl_db` | The "buy now, pay later" logic: credit scoring, installment plans, dunning, reacting to the payment lifecycle. |
| `notification-service` | 3007 | `notification_db` | Bridges domain events → email (Kafka → RabbitMQ → send). |

Every folder under `apps/` is designed to be extractable into its own repo —
there are no cross-imports between services; anything shared lives in
`packages/*`.

## Getting the environment up

```bash
pnpm install
pnpm infra:up                                   # Postgres, Kafka, RabbitMQ, Redis, Adminer
pnpm dev                                        # all 8 services at once, one terminal
# or: pnpm --filter <service> start:dev          # one service, one terminal
pnpm --filter catalog-service run seed           # once, with catalog-service up
```

See the full command reference (tests, build, filters) in [`CLAUDE.md`](./CLAUDE.md).

## Architecture

The deep architectural detail — why two messaging systems, the outbox
pattern, idempotency, the payment/BNPL state machines — lives in
[`../docs/`](../docs/) rather than here, to avoid the same content living
in two places:

- [**Architecture**](../docs/architecture.md) — service boundaries, the
  architecture diagram, the repository pattern for external providers.
- [**Messaging**](../docs/messaging.md) — Kafka vs. RabbitMQ, the full
  event catalog, the RabbitMQ topology.
- [**Transactional Outbox**](../docs/transactional-outbox.md) — how a
  domain write and its Kafka event are published without inconsistency.
- [**Reliability & Idempotency**](../docs/reliability-idempotency.md) —
  correlation/transaction ids, idempotency mechanisms, retry/DLQ.
- [**Payment Lifecycle**](../docs/payment-lifecycle.md) — the `Transaction`
  state machine, the webhook pipeline, refunds/disputes/chargebacks/void.
- [**Installment Plans (BNPL)**](../docs/installment-plans.md) — plan
  creation, the dunning cron, retries and defaults.

`packages/event-contracts/src/topics.ts` is the source of truth for the
Kafka event catalog and the RabbitMQ topology if the docs above ever drift.

## Known gaps (deliberately deferred, not bugs)

- **`cart.cart.checked_out.v1`** and **`auth.user.registered.v1`**: topics defined in the catalog, no publisher yet.
- **notification-service uses `userId` as the "destination email"**: no consumed domain event carries a real email address, only `userId`. See `apps/notification-service/CLAUDE.md`.

## Testing

- Unit, per service: `pnpm --filter <service> test`.
- E2E, per service: `pnpm --filter <service> test:e2e` (each one spins up its own infra via Docker Compose; some, like `bnpl-service`, publish synthetic events directly to Kafka so they don't depend on other services being up).
- Cross-service E2E: `backend/e2e/` (`pnpm test:e2e` from `backend/`) — exercises the complete system (happy path and refund) against every real service running together.

More per-service architecture detail is in each one's own `CLAUDE.md` under `apps/`.
