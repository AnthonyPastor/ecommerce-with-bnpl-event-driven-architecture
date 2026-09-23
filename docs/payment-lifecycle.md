# Payment Lifecycle

`Transaction.status` (`payment-service`) is the most involved state
machine in the system — every transition is validated by
`assertTransition()` against `PAYMENT_TRANSITIONS`
(`backend/packages/event-contracts/src/enums.ts`) and persisted atomically
with its outbox event by `PaymentsService`'s private `applyTransition()`.
Webhook-driven transitions are validated the same way as synchronous ones,
so a duplicate or out-of-order webhook delivery can never push the
transaction into an invalid state.

`CANCELLED` is a defined-but-currently-unreachable edge (no code path
produces it yet) — shown for completeness.

```mermaid
stateDiagram-v2
    [*] --> PENDING

    PENDING --> AUTHORIZED
    PENDING --> AUTHORIZATION_FAILED
    PENDING --> CANCELLED

    AUTHORIZED --> CAPTURED
    AUTHORIZED --> CAPTURE_FAILED
    AUTHORIZED --> VOIDED

    CAPTURED --> PARTIALLY_REFUNDED
    CAPTURED --> REFUNDED
    CAPTURED --> DISPUTED

    PARTIALLY_REFUNDED --> PARTIALLY_REFUNDED
    PARTIALLY_REFUNDED --> REFUNDED
    PARTIALLY_REFUNDED --> DISPUTED

    DISPUTED --> CHARGEBACK
    DISPUTED --> CAPTURED

    AUTHORIZATION_FAILED --> [*]
    CAPTURE_FAILED --> [*]
    VOIDED --> [*]
    REFUNDED --> [*]
    CHARGEBACK --> [*]
    CANCELLED --> [*]
```

## Happy path: checkout → sync authorize → async capture

Order creation and synchronous authorization happen inline in the HTTP
request; everything from the gateway's webhook onward happens
asynchronously, decoupled from any client request.

```mermaid
sequenceDiagram
    participant Client
    participant Order as order-service
    participant Payment as payment-service
    participant Gateway as FakePaymentGateway
    participant MQ as RabbitMQ

    Client->>Order: POST /orders
    Order->>Order: createOrder() - saveWithOutbox
    Order-->>Client: 201 Order CREATED

    Client->>Payment: POST /payments
    Payment->>Gateway: authorize()
    Gateway-->>Payment: gatewayReference
    Payment->>Payment: applyTransition(PENDING - AUTHORIZED)
    Payment-->>Client: 201 Transaction AUTHORIZED
    Note right of Payment: Kafka via outbox: payment.transaction.authorized.v1

    Gateway--)Gateway: schedule webhook (~2s delay)
    Gateway->>Payment: POST /webhooks/payments/fake
    Payment->>Payment: verify signature + idempotency check
    Payment-->>Gateway: 200 received
    Payment--)MQ: publish webhook.payment.process

    MQ--)Payment: WebhookProcessorConsumer
    Payment->>Payment: processWebhookEvent() - applyTransition(AUTHORIZED - CAPTURED)
    Note right of Payment: Kafka via outbox: payment.transaction.captured.v1
```

`order-service` reacts to `payment.transaction.captured.v1` by confirming
the order; `bnpl-service` reacts to the same event by creating the
installment plan — see [`installment-plans.md`](installment-plans.md).

The HTTP → RabbitMQ → DB indirection on the webhook exists so we don't
block the response to the payment gateway while writing to the database,
and to get retries for free if the write fails.

## Refund (full or partial) — fan-out to three services

Triggered the same way as capture: `PaymentGatewayPort.refund()`
schedules another async webhook. Which topic gets published, and who
reacts to it, depends on whether the refunded amount covers the full
transaction.

```mermaid
sequenceDiagram
    participant Client
    participant Payment as payment-service
    participant Gateway as FakePaymentGateway
    participant MQ as RabbitMQ
    participant Order as order-service
    participant Bnpl as bnpl-service
    participant Notif as notification-service

    Client->>Payment: POST /payments/:id/refund
    Payment->>Gateway: refund()
    Gateway-->>Payment: 201 (still CAPTURED for now)
    Gateway--)Gateway: schedule webhook (~2s delay)
    Gateway->>Payment: POST /webhooks/payments/fake (refund_succeeded)
    Payment--)MQ: publish webhook.payment.process
    MQ--)Payment: WebhookProcessorConsumer
    Payment->>Payment: processWebhookEvent() - REFUNDED or PARTIALLY_REFUNDED

    alt full refund
        Note right of Payment: Kafka - payment.transaction.refunded.v1
        Payment--)Order: markRefunded() - order.order.refunded.v1
        Payment--)Bnpl: cancelPlanForRefund() - plan CANCELLED
        Payment--)Notif: sends payment_refunded email
    else partial refund
        Note right of Payment: Kafka - payment.transaction.partially_refunded.v1
        Payment--)Order: markPaymentIncident PARTIALLY_REFUNDED
        Payment--)Bnpl: adjustPlanForPartialRefund() - plan ADJUSTED
    end
```

A **full** refund (`.refunded.v1`) moves the order to `REFUNDED` (and
clears any dispute/chargeback/partial-refund signal recorded on it). A
**partial** refund doesn't change `Order.status` — it only mirrors onto
`Order.paymentIncident` (`markPaymentIncident`), which the order's
computed `paymentStatus` reads first, so the client sees
`PARTIALLY_REFUNDED` instead of a stale `PAID`/`INSTALLMENTS_PENDING`.
`bnpl-service` reacts to both, with a different method for each — see
[`installment-plans.md`](installment-plans.md).

## Void, chargeback, dispute resolution, and authorization failure

Single-service transitions, no diagram needed:

- **Void** (`POST /payments/:id/void`, requires `AUTHORIZED`): calls
  `PaymentGatewayPort.void()` synchronously (no webhook involved) →
  `applyTransition(VOIDED)` → outbox → `payment.transaction.voided.v1`.
  `order-service` reacts by cancelling the order (`cancelOrder()`, only
  from `CREATED`).
- **Chargeback** (`POST /payments/:id/simulate-chargeback`, requires
  `CAPTURED`/`PARTIALLY_REFUNDED`): a real chargeback is initiated by the
  card network, not the merchant, so this endpoint deliberately **doesn't**
  call `PaymentGatewayPort` at all — it fires two direct, sequential
  transitions in the same request: `CAPTURED → DISPUTED`
  (`dispute_opened.v1`) → `DISPUTED → CHARGEBACK`
  (`chargeback_received.v1`). `bnpl-service` reacts by putting the plan on
  `DISPUTED_HOLD` and flagging the credit profile for rescoring.
  `order-service` reacts to both topics by mirroring the signal onto
  `Order.paymentIncident`.
- **Dispute resolved** (`POST /payments/:id/resolve-dispute`, requires
  `DISPUTED`): the mirror image of opening a dispute — the card network
  ruled in the merchant's favor, so this also bypasses
  `PaymentGatewayPort` and fires a single direct transition,
  `DISPUTED → CAPTURED` (`dispute_resolved.v1`). `bnpl-service` reacts by
  taking the plan off `DISPUTED_HOLD` back to `ACTIVE`; `order-service`
  clears `Order.paymentIncident` back to `null`, the same way a full
  refund does.
- **Authorization failure**: if the synchronous
  `PaymentGatewayPort.authorize()` call in `createPayment()` throws,
  `applyTransition(AUTHORIZATION_FAILED)` still runs (outbox →
  `payment.transaction.authorization_failed.v1`) before the original
  error is re-thrown — so `POST /payments` itself returns an error even
  though the failed-state transition was durably persisted and published.
  `order-service` reacts the same way it does to a void: `cancelOrder()`,
  so the order doesn't sit at `CREATED` forever with no payment behind
  it. Both reactions are idempotent no-ops for an order that already
  moved past `CREATED` some other way.

## Notifications: Kafka → RabbitMQ → email (two hops, on purpose)

`notification-service` separates *translating* the domain event (Kafka →
`email.send` command, no retry, pure and testable logic) from
*delivering* it (a RabbitMQ consumer with retry/DLQ that calls
`EmailProviderPort`). This keeps the event→email mapping decoupled from
retry/delivery concerns.
