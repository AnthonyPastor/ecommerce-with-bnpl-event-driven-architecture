# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this service is

`bnpl-service` is one of the independently deployable NestJS microservices of the BNPL system (see the root `README.md`). It is the actual "buy now, pay later" logic: credit approval (currently a stub that always approves), installment plan creation, reacting to the payment lifecycle (captured / refunded / partially refunded / chargeback) to keep those plans in sync, and — via its own hourly poller — actually charging installments when they come due. It consumes Kafka events and publishes a RabbitMQ command; it does not expose any write endpoints — only read (`GET /installment-plans...`).

## Commands

Run from `backend/` (the pnpm workspace root):

```bash
pnpm install                             # once
pnpm --filter bnpl-service start:dev     # dev server, port 3006 by default
pnpm --filter bnpl-service build
pnpm --filter bnpl-service test          # unit tests
pnpm --filter bnpl-service test -- activate-installment-plan.use-case.spec   # single file
pnpm --filter bnpl-service test:e2e      # needs Postgres + Kafka up, bnpl_db created
```

Local infra: `docker compose -f backend/infra/docker-compose.yml up -d` (needs Postgres, Kafka, **and RabbitMQ** — the installment-charging poller publishes to it). The e2e suite publishes a synthetic `payment.transaction.captured.v1` envelope directly to Kafka (via `kafkajs`, using `buildEventEnvelope`/`envelopeToHeaders` from `@bnpl/event-contracts`/`@bnpl/kafka-client`) rather than depending on `payment-service` being up — that keeps this service's e2e suite self-contained. Real cross-service verification lives in `backend/e2e/`.

## Architecture

### One use case per file, `execute(input)`, no god-object service

There is no single `BnplService` — each business operation is its own class under `src/bnpl/use-cases/`, implementing the generic `UseCase<TInput, TOutput>` interface (`use-cases/use-case.interface.ts`: just `execute(input: TInput): Promise<TOutput>`). `PaymentEventsConsumer` and `BnplController` each inject only the use cases they actually call, instead of one constructor pulling in every dependency the service might ever need. Follow this pattern for any new bnpl-service operation — a new use case, not a new method on a shared service.

### Real-world BNPL money flow (why this service owns installments, not payment-service)

The merchant is paid in full up front (that's what `payment.transaction.captured.v1` represents). From that point on, **`bnpl-service` — not the payment gateway — owns the installment schedule** and is who collects each installment from the consumer later; the payment gateway has no concept of "cuotas." This mirrors how Klarna/Affirm/Afterpay actually work. See `CreditScoringService` and `ActivateInstallmentPlanUseCase`.

### Scoring is a deliberate stub

`CreditScoringService.scoreUser()` always returns `{ approved: true }` — this is the seam where real scoring (payment history, external credit bureau, etc.) would plug in later. `getOrCreateProfile()` lazily creates a `CreditProfile` row per user on first contact; `blocked` and `needsRescoring` are the two flags other logic reads/writes.

### Reacting to payment events (`src/bnpl/payment-events.consumer.ts`)

Subscribes to six Kafka topics with one handler via `KafkaConsumerService.subscribe()` (from `@bnpl/kafka-client`), then dispatches by `envelope.eventType` to one use case each:
- `payment.transaction.captured.v1` → `ActivateInstallmentPlanUseCase`: creates the plan (`PENDING` → outbox `bnpl.installment_plan.created.v1` → `ACTIVE` → outbox `bnpl.installment_plan.activated.v1`, both in the same DB transaction) plus 3 `Installment` rows, skipping entirely if `paymentMethod` was `FULL` or the user's `CreditProfile.blocked`. Splitting `totalCents` into 3 uses `Math.floor(totalCents / 3)` for the first two installments and puts the remainder on the third, so they always sum exactly. Idempotent against Kafka redelivery via `SELECT pg_advisory_xact_lock(hashtext(orderId))` (same pattern as `payment-service`'s `PaymentsService.createPayment()`) plus a unique index on `InstallmentPlan.orderId` as a DB-level backstop.
- `payment.transaction.refunded.v1` → `CancelInstallmentPlanUseCase`: cancels every `PENDING`/`DUE` installment, plan → `CANCELLED`. Idempotent via a pessimistic row lock (`findOne(..., { lock: { mode: 'pessimistic_write' } })`) plus an early-return once `status` is already `CANCELLED` — the same idiom `order-service`'s `OrdersService.markRefunded()` uses.
- `payment.transaction.partially_refunded.v1` → `AdjustInstallmentPlanUseCase`: scales remaining `PENDING`/`DUE` installment amounts by `(totalCents - refundedAmountCents) / totalCents`, where `refundedAmountCents` is the plan's *cumulative* refunded total (mirroring `Transaction.refundedAmountCents` in payment-service) and the factor is always applied to each installment's immutable `originalAmountCents`, never to its already-adjusted `amountCents` — so a second partial refund reflects the combined total instead of compounding on top of the first. A plain status guard can't detect redelivery here (a second *legitimate* partial refund also leaves `status` at `ADJUSTED`), so this one additionally tracks `lastRefundEventId` (the Kafka envelope's `eventId`) to distinguish "already applied this exact event" from "a new partial refund arrived."
- `payment.transaction.chargeback_received.v1` → `HoldInstallmentPlanUseCase`: plan → `DISPUTED_HOLD`, `CreditProfile.needsRescoring = true`. No new domain event — this one is a pure internal state change, so no outbox write, just the plan+lock/guard for idempotency.
- `payment.installment_charge.captured.v1` → `MarkInstallmentPaidUseCase`: installment → `PAID`, outbox `bnpl.installment.paid.v1`.
- `payment.installment_charge.capture_failed.v1` → `MarkInstallmentFailedUseCase`: `retryCount` += 1; below 3, reschedules (`PENDING`, `dueDate` pushed out 3 days, no outbox event — internal only); at 3, `DEFAULTED` + outbox `bnpl.installment.defaulted.v1` + `CreditProfile.blocked = true`.

Most reuse the same `saveWithOutbox` transactional-outbox pattern as `order-service` (see that service's CLAUDE.md for the pattern itself).

### Installment charging ("dunning"): the one scheduled job in this codebase

Every other async flow here is reactive (a Kafka/RabbitMQ consumer) — a due date is the one thing nothing publishes an event for on its own, so this is the first (and only) `@Cron` job in the monorepo.

`InstallmentPollerService` (`src/bnpl/scheduler/installment-poller.service.ts`, `@Cron(CronExpression.EVERY_HOUR)`) delegates to `PollDueInstallmentsUseCase`, which does a plain unlocked `find()` for installments `status IN (PENDING, DUE) AND dueDate <= now()` (batched, 50 at a time) and hands each one to `ChargeDueInstallmentUseCase`.

`ChargeDueInstallmentUseCase` is where the real work happens, per installment:
1. Looks up the owning plan (`orderId`/`userId`/`currency`) via a **separate, unlocked** query filtered by the relation id (`InstallmentPlan` where `{ installments: { id } }`) — **not** an eager `relations: ['plan']` join on the row-locked read that follows. Postgres rejects `FOR UPDATE` combined with a join on the nullable side of it; this exact class of bug already bit `cancel-installment-plan.use-case.ts`/`adjust-installment-plan.use-case.ts` once (see git history), so the fix here is to never join under a lock at all, rather than route around it with a `lockTables` hint.
2. Row-locks the `Installment`, and if it's still `PENDING`, flips it to `DUE` (+ outbox `bnpl.installment.due.v1`, which notification-service already listens for) inside that transaction.
3. After commit, publishes `payment.charge_installment` (`RabbitMqTopology.routingKeys.paymentChargeInstallment` — the queue existed in the topology from day one, nothing published to it until now) via `RabbitMqPublisherService`, wrapped in `requestContext.run({ correlationId, transactionId: plan.orderId }, ...)` since a cron tick has no inbound request to inherit those ids from.

The command is republished on every poll tick for an installment still sitting at `DUE` (not just once, on the `PENDING → DUE` transition) — a deliberate simplification: `PaymentsService.chargeInstallment()` on the payment-service side treats a redelivered command for an installment with an already-in-flight charge as a safe no-op, and with the fake gateway's ~2s capture confirmation this never meaningfully double-publishes in dev/test.

payment-service reacts on `payment.installment_charge.captured.v1`/`.capture_failed.v1` (see that service's CLAUDE.md for why these are distinct topics from the generic `payment.transaction.captured.v1`) via `MarkInstallmentPaidUseCase`/`MarkInstallmentFailedUseCase` above. `retryCount`/`InstallmentStatus.DEFAULTED`/`CreditProfile.blocked` — present in the schema from the start but unused until this flow — are the retry/default bookkeeping: 3 failed attempts per installment (3-day backoff between them) before `DEFAULTED`, which blocks the user's *future* plans without cancelling their *other* installments on this one (mirrors how a real BNPL default works).
