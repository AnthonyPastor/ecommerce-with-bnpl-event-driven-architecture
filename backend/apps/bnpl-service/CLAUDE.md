# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this service is

`bnpl-service` is one of the independently deployable NestJS microservices of the BNPL system (see the root `README.md`). It is the actual "buy now, pay later" logic: credit approval (currently a stub that always approves), installment plan creation, and reacting to the payment lifecycle (captured / refunded / partially refunded / chargeback) to keep those plans in sync. It consumes Kafka events; it does not expose any write endpoints — only read (`GET /installment-plans...`).

## Commands

Run from `backend/` (the pnpm workspace root):

```bash
pnpm install                             # once
pnpm --filter bnpl-service start:dev     # dev server, port 3006 by default
pnpm --filter bnpl-service build
pnpm --filter bnpl-service test          # unit tests
pnpm --filter bnpl-service test -- bnpl.service.spec   # single file
pnpm --filter bnpl-service test:e2e      # needs Postgres + Kafka up, bnpl_db created
```

Local infra: `docker compose -f backend/infra/docker-compose.yml up -d`. The e2e suite publishes a synthetic `payment.transaction.captured.v1` envelope directly to Kafka (via `kafkajs`, using `buildEventEnvelope`/`envelopeToHeaders` from `@bnpl/event-contracts`/`@bnpl/kafka-client`) rather than depending on `payment-service` being up — that keeps this service's e2e suite self-contained. Real cross-service verification lives in `backend/e2e/`.

## Architecture

### Real-world BNPL money flow (why this service owns installments, not payment-service)

The merchant is paid in full up front (that's what `payment.transaction.captured.v1` represents). From that point on, **`bnpl-service` — not the payment gateway — owns the installment schedule** and is who collects each installment from the consumer later; the payment gateway has no concept of "cuotas." This mirrors how Klarna/Affirm/Afterpay actually work. See `CreditScoringService` and `BnplService.activatePlanForCapturedPayment()`.

### Scoring is a deliberate stub

`CreditScoringService.scoreUser()` always returns `{ approved: true }` — this is the seam where real scoring (payment history, external credit bureau, etc.) would plug in later. `getOrCreateProfile()` lazily creates a `CreditProfile` row per user on first contact; `blocked` and `needsRescoring` are the two flags other logic reads/writes.

### Reacting to payment events (`src/bnpl/payment-events.consumer.ts`)

Subscribes to four Kafka topics with one handler via `KafkaConsumerService.subscribe()` (from `@bnpl/kafka-client`), then dispatches by `envelope.eventType`:
- `payment.transaction.captured.v1` → `activatePlanForCapturedPayment()`: idempotent (checks for an existing plan by `orderId` first), skips entirely if the user's `CreditProfile.blocked`, then creates the plan (`PENDING` → outbox `bnpl.installment_plan.created.v1` → `ACTIVE` → outbox `bnpl.installment_plan.activated.v1`, both in the same DB transaction) plus 3 `Installment` rows. Splitting `totalCents` into 3 uses `Math.floor(totalCents / 3)` for the first two installments and puts the remainder on the third, so they always sum exactly.
- `payment.transaction.refunded.v1` → `cancelPlanForRefund()`: cancels every `PENDING`/`DUE` installment, plan → `CANCELLED`.
- `payment.transaction.partially_refunded.v1` → `adjustPlanForPartialRefund()`: scales remaining `PENDING`/`DUE` installment amounts by `(totalCents - refundedAmountCents) / totalCents`, plan → `ADJUSTED`.
- `payment.transaction.chargeback_received.v1` → `holdPlanForChargeback()`: plan → `DISPUTED_HOLD`, `CreditProfile.needsRescoring = true`. No new domain event — this one is a pure internal state change.

All four reuse the same `saveWithOutbox` transactional-outbox pattern as `order-service` (see that service's CLAUDE.md for the pattern itself).

### Known gap: installments never actually get charged after creation

This service creates installments with real future `dueDate`s (30/60/90 days out) but there is **no scheduled job** that finds due installments and charges them (the `payment.charge_installment` RabbitMQ command/queue is defined in `@bnpl/event-contracts`' `RabbitMqTopology` but nothing publishes or consumes it yet, and `Installment.retryCount` / `InstallmentStatus.DEFAULTED` exist but are unused). This was a deliberate scope cut — see the root plan/README for the intended design (bnpl-service polls due installments → publishes a charge command → payment-service charges via the same `PaymentGatewayPort` → bnpl-service reacts to the result) if you're picking this up.
