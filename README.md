# BNPL System with Events

An ecommerce-style BNPL (buy now, pay later) system, built with an
event-driven microservices architecture. This is a learning/skeleton
project — it prioritizes making the patterns (event-driven, outbox,
repository pattern, async webhooks, correlation/transaction id) visible and
exercisable end-to-end, rather than having every business feature fully
built out.

## Structure

```
frontend/    Standalone Next.js app (React Query + Zustand + Tailwind)
backend/     pnpm workspace — recommended Nest pattern: apps/ + packages/
```

`frontend/` and `backend/` are independent projects (each with its own
`package.json`/lockfile) — this repo works as the "guide" for running the
whole system together during development. Every folder under `backend/apps/`
is designed to be extractable into its own repo the day a team takes
ownership of that particular service.

See the [backend README](backend/README.md) (microservices, Kafka/RabbitMQ
event architecture, outbox pattern, key flows) and the
[frontend README](frontend/README.md) (stack, client architecture, pages)
for the detail on each project.

Each microservice has its own `CLAUDE.md` with the detail of its internal
architecture. `backend/packages/event-contracts/src/topics.ts` is the source
of truth for the Kafka event catalog and the RabbitMQ topology.

## Requirements

- Node.js 22+
- pnpm 12+
- Docker Desktop (Postgres, Kafka, RabbitMQ, Redis via docker-compose)

## Running everything in development

```bash
# 1. Infra (Postgres, Kafka, RabbitMQ, Redis)
cd backend
pnpm infra:up

# 2. Install dependencies
pnpm install                  # in backend/
cd ../frontend && pnpm install

# 3. Backend — each service in its own terminal
cd backend
pnpm --filter auth-service start:dev          # :3001
pnpm --filter catalog-service start:dev       # :3002
pnpm --filter cart-service start:dev          # :3003
pnpm --filter order-service start:dev         # :3004
pnpm --filter payment-service start:dev       # :3005
pnpm --filter bnpl-service start:dev          # :3006
pnpm --filter notification-service start:dev  # :3007
pnpm --filter api-gateway start:dev           # :3000

# 4. Seed the catalog (once, after catalog-service is connected to its DB)
pnpm --filter catalog-service run seed

# 5. Frontend
cd ../frontend
pnpm dev                                      # :3100
```

Open `http://localhost:3100`.

## Stopping the infra

```bash
cd backend
pnpm infra:down
```
