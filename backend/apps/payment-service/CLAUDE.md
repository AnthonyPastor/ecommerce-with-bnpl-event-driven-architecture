# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this service is

`payment-service` is one of the independently deployable NestJS microservices of the BNPL system (see the root `README.md`). It owns the payment state machine (`Transaction`), the payment-gateway abstraction, and the async webhook pipeline (including its own simulated one for local dev). It's the most architecturally involved service in this monorepo — read this file before touching `src/payments/`.

## Commands

Run from `backend/` (the pnpm workspace root):

```bash
pnpm install                                 # once
pnpm --filter payment-service start:dev      # dev server, port 3005 by default
pnpm --filter payment-service build
pnpm --filter payment-service test           # unit tests
pnpm --filter payment-service test -- payments.service.spec   # single file
pnpm --filter payment-service test:e2e       # needs Postgres + Kafka + RabbitMQ up, payment_db created
```

Local infra: `docker compose -f backend/infra/docker-compose.yml up -d` (needs all three: Postgres, Kafka, RabbitMQ).

**Running the e2e suite standalone matters**: it binds a real HTTP listener on port 3015 because `FakePaymentGateway` makes a genuine self-loopback HTTP call to simulate an async gateway webhook — `supertest`'s in-memory server isn't enough. If you kill the test process abnormally (Ctrl-C mid-run, a crashed background shell), **check for and kill orphaned `node.exe` processes still holding port 3015 or a Postgres connection before rerunning** — stale processes racing the new run is the most common cause of flaky "Driver not Connected" / stuck-at-AUTHORIZED failures here, not a real bug.

## Architecture

### The payment state machine

`PAYMENT_TRANSITIONS` lives in `@bnpl/event-contracts` (shared, not duplicated here) and is re-exported + wrapped by `assertTransition()` in `src/payments/payment-state-machine.ts`. Every state change goes through `PaymentsService`'s private `applyTransition()`, which validates the transition, persists `Transaction` + `TransactionStatusHistory` + an outbox event atomically (same `saveWithOutbox` pattern as `order-service` — see that service's CLAUDE.md for the pattern itself), and tags `source: 'sync' | 'webhook'` on the history row.

```
PENDING → AUTHORIZED | AUTHORIZATION_FAILED | CANCELLED
AUTHORIZED → CAPTURED | CAPTURE_FAILED | VOIDED
CAPTURED → PARTIALLY_REFUNDED | REFUNDED | DISPUTED
PARTIALLY_REFUNDED → PARTIALLY_REFUNDED | REFUNDED | DISPUTED
DISPUTED → CHARGEBACK | CAPTURED
```

`AUTHORIZATION_FAILED`, `CAPTURE_FAILED`, `VOIDED`, `REFUNDED`, `CHARGEBACK`, and `CANCELLED` are the terminal states (no outgoing transitions). `payment-state-machine.ts`'s `isTerminalPaymentStatus()` derives that list from `PAYMENT_TRANSITIONS` itself (an empty transitions array = terminal) rather than hand-maintaining a parallel one — see the next section for where this matters.

### One payment per order at a time, race-proof

`PaymentsService.createPayment()` rejects a second `POST /payments` for an order that already has a non-terminal transaction (per `isTerminalPaymentStatus()` above) — a captured/in-flight one must stay blocked, a failed/voided/refunded/charged-back one must remain retryable. The guard-check and the new `PENDING` row's insert run inside one DB transaction, opened with `SELECT pg_advisory_xact_lock(hashtext(orderId))` first: on an order's *first* payment there's no row yet for a row-level lock to serialize on, so the advisory lock serializes concurrent `createPayment` calls on the `orderId` key itself — otherwise two concurrent requests can both read "no blocking transaction" before either's insert commits, and both proceed to double-charge.

The `PENDING` row is committed *before* `gateway.authorize()` is called, and that call is bounded by `PAYMENT_GATEWAY_TIMEOUT_MS` (default 10s, via the local `withTimeout()` helper) — without it, a real gateway adapter that hangs would leave the transaction stuck at `PENDING` forever with no way out (`voidPayment()` only accepts `AUTHORIZED`). A timeout is treated exactly like any other `authorize()` failure: it drives the transaction to the terminal `AUTHORIZATION_FAILED`, which the guard above then lets be retried.

### `GET /payments?orderId=` is scoped to the caller

Returns only transactions whose `userId` matches the `x-user-id` header — set by `api-gateway`'s `GatewayAuthGuard` from the verified JWT before the request ever reaches this service (see that service's CLAUDE.md). Without this, any authenticated user could read another user's payment history for an order by guessing/enumerating its id.

### Repository pattern for the gateway

`PaymentGatewayPort` (`src/payments/ports/payment-gateway.port.ts`) is the abstract contract (`authorize`, `capture`, `refund`, `void`, `verifyWebhookSignature`, `parseWebhookPayload`). `FakePaymentGateway` is the only implementation today, selected via the `PAYMENT_GATEWAY` DI token in `payments.module.ts`'s factory, itself driven by `PAYMENT_GATEWAY_PROVIDER` env var. A real MercadoPago/PayPal adapter implements the same port; nothing else in this service changes.

**`FakePaymentGateway`'s `authorize()` is synchronous, but capture confirmation is asynchronous by design**: it schedules a real HTTP callback to this same service's `/webhooks/payments/fake` after `FAKE_GATEWAY_CAPTURE_DELAY_MS` (default 2000ms), signed with an HMAC over `JSON.stringify(payload)` (a simplification — a real gateway integration needs a raw-body parser for byte-exact signature verification, not present here). This exists specifically to exercise the real async webhook path in dev/tests, not just the sync happy path.

Pending timers are tracked per `gatewayReference` (`timersByReference`), and `void()` cancels whichever one is still pending for that reference — without this, voiding a transaction while its self-scheduled `capture_succeeded` webhook is still in flight lets that webhook arrive later and drive an invalid `VOIDED → CAPTURED` transition through `WebhookProcessorConsumer`, which `assertTransition` rejects and RabbitMQ retries into the DLQ.

### The webhook pipeline: HTTP → RabbitMQ → DB, not HTTP → DB

`WebhooksController.receiveWebhook()` does the minimum to respond fast: verify signature, check `WebhookEvent` idempotency (`UNIQUE(gateway, externalEventId)`), persist the raw event, publish a command to RabbitMQ (`q.payments.webhook.process`, exchange/routing key from `@bnpl/event-contracts`' `RabbitMqTopology`), and return 200. A `save()` that loses a race against a truly concurrent identical delivery (both pass the `findOne` check before either commits) hits that same unique constraint — caught and turned into the normal `{ duplicate: true }` response instead of an unhandled 500. The actual state transition happens in `WebhookProcessorConsumer` (`src/payments/webhook-processor.consumer.ts`), which subscribes via `@bnpl/rabbitmq-client`'s `RabbitMqConsumerService` (retry with backoff, then DLQ, handled by that package — see its own code, not reimplemented here) and calls `PaymentsService.processWebhookEvent()`.

**Why the indirection**: don't let a slow DB write block the HTTP response to a payment gateway, and get retries for free if the DB write fails.

**The consumer checks `WebhookEvent.processedAt` before calling `processWebhookEvent()`**, not just after: RabbitMQ's at-least-once delivery means the same message can be redelivered (e.g. the process crashes after committing but before acking). Relying only on `assertTransition()` to catch a redelivered event isn't enough — `PARTIALLY_REFUNDED → PARTIALLY_REFUNDED` is a legitimate self-transition (a second real partial refund), so it wouldn't reject a redelivered one either. Checking `processedAt` first makes redelivery an explicit no-op instead of depending on that side effect.

### Recovering the business `transactionId` from an unrelated HTTP request

A webhook is a brand-new HTTP request (own `correlationId`) with no relation to the original checkout request. `applyTransition()` always looks up `transaction.orderId` from the DB row itself and calls `requestContext.setTransactionId(transaction.orderId)` before writing the outbox event — never trust an inbound header for this on the webhook path.

### Partial vs. full refunds

`Transaction.refundedAmountCents` accumulates across possibly-multiple partial refunds. `processWebhookEvent()`'s `refund_succeeded` branch delegates to `applyRefund()`, which — unlike the generic `applyTransition()` — reads the transaction with a pessimistic row lock (`lock: { mode: 'pessimistic_write' }`) and only *then* computes `newRefundedTotal`/picks `REFUNDED` (topic `payment.refunded`) vs. `PARTIALLY_REFUNDED` (topic `payment.partiallyRefunded`), inside that same locked transaction. That ordering matters: deciding the target status from an earlier, unlocked read (as this used to do) is a lost-update race — two concurrent refund webhooks could both read the same stale total and the second commit would silently drop the first's contribution. `PaymentsService.refundPayment()` is the dev-facing trigger (`POST /payments/:id/refund`, optional `amountCents` body — omitted means "refund whatever remains").

### Chargebacks don't go through the gateway

Real chargebacks are card-network-initiated, not something a merchant "requests" from a gateway — so `simulateChargeback()` (`POST /payments/:id/simulate-chargeback`) doesn't call `PaymentGatewayPort` at all. It drives two `applyTransition()` calls directly and sequentially: `CAPTURED → DISPUTED` (topic `payment.transaction.dispute_opened.v1`) then `DISPUTED → CHARGEBACK` (topic `payment.transaction.chargeback_received.v1`).

### Charging an installment is a second `Transaction`, not a new state

`chargeInstallment()` (called from `InstallmentChargeConsumer`, triggered by bnpl-service's `payment.charge_installment` RabbitMQ command — see that service's CLAUDE.md for the poller side) mirrors `createPayment()` exactly: same sync-`authorize`/async-`capture`-webhook shape, same `PaymentGatewayPort`, same `PAYMENT_TRANSITIONS`. What's different:
- **Idempotency key is `installmentId`, not `orderId`.** The order's original `Transaction` is `CAPTURED` (non-terminal in the sense `createPayment()`'s guard cares about) for the entire life of the installment plan, so `createPayment()`'s own `orderId`-keyed advisory lock/guard can't be reused here — `chargeInstallment()` has its own, keyed on `installmentId` (`Transaction.installmentId`, a nullable column, `null` for every ordinary payment).
- **A redelivered/duplicate charge command is a silent no-op (`return null`), not a thrown `ConflictException`.** This is a command queue, not an HTTP client — a "duplicate" here means RabbitMQ redelivery or bnpl-service's poller republishing while a charge is still in flight (see that service's CLAUDE.md), not a caller error to reject.
- **Publishes `payment.installment_charge.captured.v1` / `.capture_failed.v1` instead of the generic `.captured.v1` / `.capture_failed.v1` / `.authorization_failed.v1`.** `processWebhookEvent()`'s `capture_succeeded`/`capture_failed` branches (shared with ordinary payments) branch on `transaction.installmentId` to pick the topic; the sync-authorize failure path in `chargeInstallment()` always publishes the installment-specific failed topic directly. Reusing the generic topics would make bnpl-service's `PaymentEventsConsumer` (which reacts to `.captured.v1` by re-activating a plan) and order-service's `PaymentEventsConsumer` (which reacts to `.captured.v1`/`.authorization_failed.v1` by confirming/cancelling the order) misfire on every installment charge — harmless in practice today since both are idempotent no-ops past their guard conditions, but confusing and worth avoiding with distinct topics instead of relying on that.

### Downstream consumers

`bnpl-service` reacts to `payment.transaction.captured.v1` (creates the installment plan), `.refunded.v1`/`.partially_refunded.v1` (cancels/adjusts it), `.chargeback_received.v1` (holds it + flags the credit profile), and `.installment_charge.captured.v1`/`.capture_failed.v1` (marks an installment `PAID`, or retries/`DEFAULTED`s it). `order-service` reacts to `.captured.v1` (confirms the order), `.refunded.v1` (marks it `REFUNDED`), and `.partially_refunded.v1`/`.dispute_opened.v1`/`.chargeback_received.v1` (mirrors the signal onto the order so its computed payment status reflects it — see that service's CLAUDE.md). `notification-service` reacts to `.refunded.v1` (sends an email). None of these are payment-service's concern beyond knowing the outbox event is the integration point — see each service's own CLAUDE.md for their side.
