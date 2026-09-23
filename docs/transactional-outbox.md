# Transactional Outbox

Publishing directly to Kafka inside a database transaction isn't atomic
(the DB and Kafka are two different systems) — if the DB commit fails
after publishing, or the publish fails after the commit, the state ends
up inconsistent: either Kafka has a fact the database never actually
recorded, or the database changed and nobody downstream ever finds out.

This is solved with the **outbox pattern** (`@bnpl/outbox`):

1. The service saves the domain entity *and* a row in `outbox_event` in
   the **same** Postgres transaction
   (`saveWithOutbox(queryRunner, entity, event)`).
2. `OutboxPublisherService` (a separate poller, decoupled from the HTTP
   request) reads unpublished rows and sends them to Kafka.

This guarantees that every event Kafka ends up seeing corresponds to a
change that was actually persisted — never the other way around. The
reference implementation is `OrdersService.createOrder()` in
`backend/apps/order-service` — copy that shape for any new
event-producing flow.

## Why not publish synchronously and roll back on failure?

A Kafka publish can't participate in a Postgres transaction's commit/
rollback — there's no two-phase commit between the two systems here.
Trying to "publish first, then save" or "save first, then publish and roll
back on failure" both leave a window where one system has state the other
doesn't. Decoupling the publish into an async poller removes that window
entirely: the write to Postgres is the only thing that has to succeed
atomically, and the poller keeps retrying until Kafka has seen it.

See [`messaging.md`](messaging.md) for the full event catalog this
produces, and [`reliability-idempotency.md`](reliability-idempotency.md)
for how consumers handle a Kafka event being delivered more than once.
