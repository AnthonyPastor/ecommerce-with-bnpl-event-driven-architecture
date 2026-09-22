# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this service is

`notification-service` is one of the independently deployable NestJS microservices of the BNPL system (see the root `README.md`). It bridges Kafka domain events to actual email delivery: a Kafka→RabbitMQ translator plus a RabbitMQ consumer that calls an `EmailProviderPort`. It exposes one read endpoint (`GET /notifications`) for inspecting what was "sent."

## Commands

Run from `backend/` (the pnpm workspace root):

```bash
pnpm install                                     # once
pnpm --filter notification-service start:dev     # dev server, port 3007 by default
pnpm --filter notification-service build
pnpm --filter notification-service test          # unit tests
pnpm --filter notification-service test -- domain-events-to-commands.consumer.spec   # single file
pnpm --filter notification-service test:e2e      # needs Postgres + Kafka + RabbitMQ up, notification_db created
```

Local infra: `docker compose -f backend/infra/docker-compose.yml up -d` (needs all three).

## Architecture

### Two-hop pipeline, on purpose: Kafka → RabbitMQ → email

`DomainEventsToCommandsConsumer` (`src/notifications/domain-events-to-commands.consumer.ts`) subscribes to Kafka domain events (`order.order.created.v1`, `bnpl.installment.due.v1`, `payment.transaction.refunded.v1`, `payment.transaction.authorization_failed.v1`, `payment.transaction.capture_failed.v1`) and translates each into an `email.send` RabbitMQ command — it does no retrying and knows nothing about how email actually gets sent. `EmailCommandConsumer` (`src/notifications/email-command.consumer.ts`) is the other end: it consumes that RabbitMQ queue (with retry/DLQ via `@bnpl/rabbitmq-client`'s `bindRetryTopology`), calls `EmailProviderPort.send()`, and persists a `NotificationLog` row. Keep this split when adding new notification types — the mapping logic (`buildEmailCommand`, a pure exported function, easy to unit test without mocking Kafka/RabbitMQ) belongs in the first consumer; delivery/retry concerns belong in the second.

### Repository pattern for email delivery

`EmailProviderPort` (`src/notifications/ports/email-provider.port.ts`) is the abstract contract; `ConsoleEmailProvider` (just logs) is the only implementation, selected via the `EMAIL_PROVIDER` DI token in `notifications.module.ts`'s factory (driven by `EMAIL_PROVIDER` env var). A SendGrid/SES adapter implements the same port.

### Known gap: "to" is a userId, not a real email address

None of the Kafka event payloads this service consumes carry an email address — only `userId`. `buildEmailCommand()` currently uses `userId` as the `to` field directly (harmless today since `ConsoleEmailProvider` just logs it). A real email provider needs an actual address, which means either a synchronous lookup to `auth-service` (e.g. via `PropagatingHttpService`) or a local read-model kept in sync via an `auth.user.registered.v1` event — neither exists yet. See the `TODO` comment in `domain-events-to-commands.consumer.ts`.
