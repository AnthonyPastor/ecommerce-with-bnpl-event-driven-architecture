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
pnpm --filter payment-service test           # unit tests (28 as of Fase 5)
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

### Repository pattern for the gateway

`PaymentGatewayPort` (`src/payments/ports/payment-gateway.port.ts`) is the abstract contract (`authorize`, `capture`, `refund`, `void`, `verifyWebhookSignature`, `parseWebhookPayload`). `FakePaymentGateway` is the only implementation today, selected via the `PAYMENT_GATEWAY` DI token in `payments.module.ts`'s factory, itself driven by `PAYMENT_GATEWAY_PROVIDER` env var. A real MercadoPago/PayPal adapter implements the same port; nothing else in this service changes.

**`FakePaymentGateway`'s `authorize()` is synchronous, but capture confirmation is asynchronous by design**: it schedules a real HTTP callback to this same service's `/webhooks/payments/fake` after `FAKE_GATEWAY_CAPTURE_DELAY_MS` (default 2000ms), signed with an HMAC over `JSON.stringify(payload)` (a simplification — a real gateway integration needs a raw-body parser for byte-exact signature verification, not present here). This exists specifically to exercise the real async webhook path in dev/tests, not just the sync happy path.

### The webhook pipeline: HTTP → RabbitMQ → DB, not HTTP → DB

`WebhooksController.receiveWebhook()` does the minimum to respond fast: verify signature, check `WebhookEvent` idempotency (`UNIQUE(gateway, externalEventId)`), persist the raw event, publish a command to RabbitMQ (`q.payments.webhook.process`, exchange/routing key from `@bnpl/event-contracts`' `RabbitMqTopology`), and return 200. The actual state transition happens in `WebhookProcessorConsumer` (`src/payments/webhook-processor.consumer.ts`), which subscribes via `@bnpl/rabbitmq-client`'s `RabbitMqConsumerService` (retry with backoff, then DLQ, handled by that package — see its own code, not reimplemented here) and calls `PaymentsService.processWebhookEvent()`.

**Why the indirection**: don't let a slow DB write block the HTTP response to a payment gateway, and get retries for free if the DB write fails.

### Recovering the business `transactionId` from an unrelated HTTP request

A webhook is a brand-new HTTP request (own `correlationId`) with no relation to the original checkout request. `applyTransition()` always looks up `transaction.orderId` from the DB row itself and calls `requestContext.setTransactionId(transaction.orderId)` before writing the outbox event — never trust an inbound header for this on the webhook path.

### Partial vs. full refunds

`Transaction.refundedAmountCents` accumulates across possibly-multiple partial refunds. `processWebhookEvent()`'s `refund_succeeded` branch computes `newRefundedTotal = transaction.refundedAmountCents + refundedNow` and picks `REFUNDED` (topic `payment.refunded`) vs. `PARTIALLY_REFUNDED` (topic `payment.partiallyRefunded`) based on whether that covers `amountCents`. `PaymentsService.refundPayment()` is the dev-facing trigger (`POST /payments/:id/refund`, optional `amountCents` body — omitted means "refund whatever remains").

### Chargebacks don't go through the gateway

Real chargebacks are card-network-initiated, not something a merchant "requests" from a gateway — so `simulateChargeback()` (`POST /payments/:id/simulate-chargeback`) doesn't call `PaymentGatewayPort` at all. It drives two `applyTransition()` calls directly and sequentially: `CAPTURED → DISPUTED` (topic `payment.transaction.dispute_opened.v1`) then `DISPUTED → CHARGEBACK` (topic `payment.transaction.chargeback_received.v1`).

### Downstream consumers

`bnpl-service` reacts to `payment.transaction.captured.v1` (creates the installment plan), `.refunded.v1`/`.partially_refunded.v1` (cancels/adjusts it), and `.chargeback_received.v1` (holds it + flags the credit profile). `order-service` reacts to `.refunded.v1` (marks the order `REFUNDED`). `notification-service` reacts to `.refunded.v1` (sends an email). None of these are payment-service's concern beyond knowing the outbox event is the integration point — see each service's own CLAUDE.md for their side.
