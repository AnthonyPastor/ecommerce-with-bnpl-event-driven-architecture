# Messaging: Kafka vs. RabbitMQ

The system deliberately uses **two messaging mechanisms with different
guarantees** — see [`architecture.md`](architecture.md) for where each
service sits relative to them.

- **Kafka = immutable facts.** A domain event (`order.created`,
  `payment.captured`, etc.) represents something that *already happened* —
  it's an audit log other services can react to, and from which the
  system's state could in principle be reconstructed. You never retry "the
  order" itself — the fact already occurred.
- **RabbitMQ = commands/tasks.** A "do this" instruction (send an email,
  process a webhook, charge an installment) that needs retries with
  backoff and a dead-letter queue if it ultimately fails — work-queue
  semantics, not log semantics.

> **Kafka describes what happened. RabbitMQ asks something to be done.**

Naming convention for topics: `<domain>.<entity>.<event>.v1`.

## Kafka event catalog (`backend/packages/event-contracts/src/topics.ts`)

| Topic | Producer | Consumers |
|---|---|---|
| `order.order.created.v1` | order-service | notification-service |
| `order.order.confirmed.v1` | order-service | — (defined; nothing consumes it today) |
| `order.order.cancelled.v1` | order-service | — |
| `order.order.refunded.v1` | order-service | — |
| `payment.transaction.authorized.v1` / `.captured.v1` | payment-service | bnpl-service (captured → activates the installment plan), order-service (captured → confirms the order, emits `order.order.confirmed.v1`) |
| `payment.transaction.authorization_failed.v1` | payment-service | order-service (cancels the order), notification-service (email) |
| `payment.transaction.capture_failed.v1` | payment-service | notification-service (email) |
| `payment.transaction.voided.v1` | payment-service | order-service (cancels the order) |
| `payment.transaction.cancelled.v1` | payment-service | — |
| `payment.transaction.partially_refunded.v1` | payment-service | bnpl-service (adjusts the plan), order-service (mirrors the signal onto the order's payment status) |
| `payment.transaction.refunded.v1` | payment-service | order-service (marks the order `REFUNDED`), bnpl-service (cancels the plan), notification-service (email) |
| `payment.transaction.dispute_opened.v1` | payment-service | order-service (mirrors the signal onto the order's payment status) |
| `payment.transaction.dispute_resolved.v1` | payment-service | order-service (clears the payment-incident signal), bnpl-service (takes the plan off `DISPUTED_HOLD`) |
| `payment.transaction.chargeback_received.v1` | payment-service | bnpl-service (puts the plan on hold + rescoring flag), order-service (mirrors the signal onto the order's payment status) |
| `payment.installment_charge.captured.v1` / `.capture_failed.v1` | payment-service | bnpl-service (marks the installment `PAID`, or retries/`DEFAULTED`s it) |
| `bnpl.installment_plan.created.v1` / `.activated.v1` / `.adjusted.v1` / `.cancelled.v1` | bnpl-service | — |
| `bnpl.installment.due.v1` | bnpl-service | notification-service (email) |
| `bnpl.installment.paid.v1` / `.defaulted.v1` | bnpl-service | — |
| `bnpl.installment.overdue.v1` | — (defined, unused — `PENDING`/`DUE`/retry cover this today) | — |
| `cart.cart.checked_out.v1` | — (deferred) | — |
| `auth.user.registered.v1` | — (deferred) | — |

## RabbitMQ topology (`backend/packages/event-contracts/src/topics.ts` → `RabbitMqTopology`)

`commands` exchange with dedicated routing keys/queues, each with retry +
DLQ via `bindRetryTopology()` (`@bnpl/rabbitmq-client`): main queue →
`retry.<queue>` (with TTL, dead-lettered back to the main queue) →
`dlq.<queue>` once retries are exhausted.

| Queue | Publishes | Consumes | Purpose |
|---|---|---|---|
| `q.notifications.email.send` | notification-service (from the Kafka→RabbitMQ bridge) | notification-service | Decouples sending an email from translating the event. |
| `q.payments.webhook.process` | payment-service (`WebhooksController`) | payment-service (`WebhookProcessorConsumer`) | Don't block the HTTP response to the payment gateway while writing to the DB. |
| `q.payments.charge_installment` | bnpl-service (`ChargeDueInstallmentUseCase`) | payment-service (`InstallmentChargeConsumer`) | Decouples finding a due installment from actually charging it. |
| `q.documents.generate_contract` | — (defined, no flow yet) | — | Reserved. |

For the retry/DLQ mechanics and how consumers stay safe under redelivery,
see [`reliability-idempotency.md`](reliability-idempotency.md).
