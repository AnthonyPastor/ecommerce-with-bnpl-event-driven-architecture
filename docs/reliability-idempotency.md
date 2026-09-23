# Reliability & Idempotency

Kafka and RabbitMQ both deliver **at-least-once** — the same message can
arrive twice (a consumer crash between processing and acking, a network
retry, a rebalance). Every consumer in this system is written assuming
redelivery *will* happen, not as an edge case.

## Correlation ID vs. Transaction ID

- **`correlationId`**: one per HTTP request. Generated/read by
  `CorrelationIdMiddleware` (`@bnpl/observability`) in each service, stored
  in an `AsyncLocalStorage` (`RequestContextService`), automatically
  injected into every log line (pino `mixin()`) and automatically
  propagated on outbound HTTP calls (`PropagatingHttpService`) and in
  Kafka/RabbitMQ message headers. Never passed manually through function
  parameters.
- **`transactionId`**: identifies a *business* flow (in practice, always
  `order.id`) and survives across otherwise-unrelated HTTP requests.
  `order-service` "creates" it (`requestContext.setTransactionId(order.id)`)
  right after `createOrder()`. A payment webhook arrives as a brand-new
  HTTP request (with its own new `correlationId`) — `payment-service`
  recovers the correct `transactionId` by looking up the
  `Transaction`/`orderId` row in its own database, **never trusting an
  inbound header** for this.

This lets you trace a complete business flow (checkout → payment → async
webhook → refund) across logs from different services and different HTTP
requests, using the same `transactionId`.

## Idempotency mechanisms

No single technique covers every case — the mechanism used depends on
whether there's already a row to lock on:

| Mechanism | Used when | Example |
|---|---|---|
| Postgres advisory lock (`pg_advisory_xact_lock`) | First write for a key — no row exists yet to take a row lock on, so two concurrent requests could both pass a "does this exist" check before either commits | `PaymentsService.createPayment()` serializes concurrent `POST /payments` for the same `orderId` |
| Pessimistic row lock + status guard | A row already exists; redelivery should be a silent no-op once past a given state | `OrdersService.markConfirmed()` — `if (order.status !== CREATED) return` |
| Unique DB index | Backstop under the two above, in case application-level locking is ever bypassed | `InstallmentPlan.orderId` |
| Event-identity tracking | Status alone can't distinguish "already applied this exact event" from "a new, legitimate event of the same kind arrived" | `lastRefundEventId` on `InstallmentPlan` — a second *real* partial refund also leaves `status: ADJUSTED`, so the Kafka envelope's own `eventId` is what disambiguates redelivery from a genuine second refund |
| RabbitMQ retry + DLQ (`bindRetryTopology()`) | A command handler fails transiently (DB hiccup, timeout) | main queue → `retry.<queue>` (TTL) → back to main → `dlq.<queue>` after `maxRetries` |

## A concrete reliability bug: RabbitMQ shutdown could hang forever

`RabbitMqModule.onModuleDestroy()` closes the AMQP channel and connection
on shutdown. That sounds like enough — but `amqplib`'s `.close()` promise
has **no built-in timeout**: it just waits for the broker to reply with
`ConnectionCloseOk`, and if that reply never arrives (e.g. the channel
still had an in-flight `consume()` callback processing a message when
shutdown started), the promise never settles and the underlying TCP socket
is never released.

This is exactly what made `payment-service`'s e2e test suite hang
indefinitely after every single test had already passed. It was diagnosed
by:

1. Adding temporary logging to confirm `onModuleDestroy()` *was* running,
   and usually completing — but not always.
2. Inspecting the hung process's open TCP connections
   (`Get-NetTCPConnection -OwningProcess <pid>`), which showed a still-
   `Established` connection to RabbitMQ's port while Postgres and Kafka
   connections had already closed cleanly.
3. Reading `amqplib`'s source (`ChannelModel.close()` is a bare
   `promisify()` around the callback-style close handshake — no timeout
   anywhere in the chain).

The fix: race each `close()` call against a timeout, and if it doesn't
resolve in time, reach into `amqplib`'s internal `Connection.stream` (not
part of its public API, documented inline in the fix) and destroy the raw
socket directly — the same thing a normal close does internally, just
forced. This isn't only a test-suite fix: any graceful-shutdown path (a
container's `SIGTERM` grace period, for instance) needs shutdown to be
*bounded*, not just attempted.
