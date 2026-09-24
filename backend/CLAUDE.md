# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The backend of the BNPL system: a pnpm workspace containing 8 independently deployable NestJS microservices, the shared libraries they depend on, a cross-service e2e suite, and the local dev infrastructure (docker-compose). See the root `README.md` and `README.md` in this folder for the full architecture write-up and event catalog. Each service under `apps/*` has its own `CLAUDE.md` — read the relevant one before making service-specific changes; this file covers only what's shared across the workspace.

## Commands

```bash
# once
pnpm install

# infra: Postgres, Kafka (KRaft), RabbitMQ, Redis, Adminer
pnpm infra:up
pnpm infra:down

# all 8 services at once (parallel, one terminal, output prefixed per package)
pnpm dev

# one service (from this folder, backend/)
pnpm --filter <service> start:dev     # e.g. pnpm --filter order-service start:dev
pnpm --filter <service> build
pnpm --filter <service> test
pnpm --filter <service> test -- <spec-name>     # single test file
pnpm --filter <service> test:e2e                # per-service e2e (needs infra up + that service's DB)

# every service's build/test (filters to apps/*, skips packages/* and e2e/)
pnpm build
pnpm test
pnpm lint

# cross-service e2e suite (needs the full stack — infra + every service — running)
pnpm test:e2e
```

Services: `auth-service` (3001), `catalog-service` (3002), `cart-service` (3003), `order-service` (3004), `payment-service` (3005), `bnpl-service` (3006), `notification-service` (3007), `api-gateway` (3000, the only one the frontend talks to). Each has a `.env.example` to copy to `.env`.

## Architecture

### Workspace layout

```
apps/<service>/       8 standalone NestJS apps, each own package.json + .env
packages/<name>/      shared libs, consumed via workspace protocol (@bnpl/<name>)
e2e/                  cross-service e2e suite (talks to the whole stack over HTTP/Kafka)
infra/                docker-compose.yml + Postgres init script (7 DBs, one per service except api-gateway)
```

`pnpm-workspace.yaml` globs `apps/*`, `packages/*`, `e2e`. Each service is meant to be extractable to its own repo later — don't add cross-imports between `apps/*` folders; anything two services both need belongs in `packages/*`.

### Shared packages and what each one owns

- **`@bnpl/event-contracts`** — the source of truth with no runtime dependencies on the others: `EventEnvelope` type/zod schema (`envelope.ts`), the full Kafka topic + RabbitMQ exchange/queue catalog (`topics.ts`), and shared enums/state machines like `PaymentStatus`/`PAYMENT_TRANSITIONS`, `OrderStatus`, `InstallmentPlanStatus`/`InstallmentStatus` (`enums.ts`). Start here when adding a new event or changing a state machine.
- **`@bnpl/observability`** — `RequestContextService` (`AsyncLocalStorage`-backed correlationId/transactionId), `RequestContextModule` (`@Global()`), `CorrelationIdMiddleware`, `ObservabilityLoggerModule` (nestjs-pino, auto-stamps every log line via the context), `PropagatingHttpService` (wraps outbound HTTP calls, auto-forwards `x-correlation-id`/`x-transaction-id`).
- **`@bnpl/kafka-client`** — `KafkaModule.forRoot()`, `KafkaProducerService.publish(envelope)`, `KafkaConsumerService.subscribe(topics, handler, groupId)`. Headers carry correlation/transaction/causation ids so a consumer doesn't need to deserialize the payload to know them.
- **`@bnpl/rabbitmq-client`** — `RabbitMqModule.forRoot()`, `RabbitMqPublisherService`, `RabbitMqConsumerService`, and `bindRetryTopology()` which declares the main queue + a TTL-based `retry.<queue>` + `dlq.<queue>` — use this for any new command queue instead of hand-rolling retry.
- **`@bnpl/outbox`** — `saveWithOutbox(queryRunner, entity, event)` (atomic domain-row + outbox-row save) and `OutboxModule.forFeature({ producerName, pollIntervalMs })` which registers `OutboxPublisherService` to poll and publish to Kafka. Any service that publishes Kafka domain events uses this — see `order-service`'s `OrdersService.createOrder()` for the reference usage.
- **`@bnpl/config`** — shared env/config loading helpers.

### Two event systems, one convention each

Kafka topics follow `<domain>.<entity>.<event>.v1` and are for **immutable domain events** (something that already happened — audit trail, other services react to it). RabbitMQ is for **commands** (do this thing, with retry/DLQ semantics) — e.g. `email.send`, `webhook.payment.process`, `payment.charge_installment`. Never publish a command to Kafka or a domain event to RabbitMQ; if you're unsure which one a new message is, ask "is this a fact that happened, or an instruction to do something" — see `backend/README.md` for the full catalog and per-flow walkthroughs.

### Correlation ID vs. transaction ID (implementation detail)

`CorrelationIdMiddleware` runs on every service and seeds `RequestContextService` per-request; `ObservabilityLoggerModule`'s pino `mixin()` reads it so you never pass it manually into a logger call. `transactionId` is set explicitly by whichever service owns the business flow's root aggregate (`order-service` sets it to `order.id` right after `createOrder()`) and is recovered — never trusted from a header — by any service reacting later via an out-of-band trigger like a webhook (see `payment-service/CLAUDE.md`'s "Recovering the business transactionId" section).

### The repeated TypeORM gotcha

Every entity with a nullable string (or other nullable) column needs an explicit `type: 'varchar'` (or correct PG type) in `@Column()` — omitting it makes `reflect-metadata` infer `Object`, and Postgres `synchronize: true` throws `DataTypeNotSupportedError` at bootstrap. This has bitten every service that skipped it; don't skip it on new entities.

### Kafka cold-start gotcha

A brand-new topic's metadata can lag on this single-node KRaft broker right after `infra:up`, making `consumer.subscribe()` throw "This server does not host this topic-partition." `KafkaConsumerService.subscribe()` already retries (5 attempts, 500ms apart) to absorb this — if you see it anyway, infra likely isn't fully warm yet, not a code bug.

### Orphaned node processes cause flaky test runs

Killing a test run abnormally (Ctrl-C mid e2e, a crashed background shell) can leave `node.exe` processes holding a Postgres connection or a port (e.g. `payment-service`'s e2e suite binds 3015 for its self-loopback webhook). Symptoms look like a real bug (stuck-at-`AUTHORIZED` payments, "Driver not Connected") but are usually stale processes racing the new run — check `tasklist`/kill orphans before debugging further.
