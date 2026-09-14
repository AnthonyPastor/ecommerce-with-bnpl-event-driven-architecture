# BNPL System with Events

Sistema BNPL (buy now, pay later) tipo ecommerce, con arquitectura de
microservicios orientada a eventos. Es un proyecto de aprendizaje/skeleton —
prioriza que los patrones (event-driven, outbox, repository pattern, webhooks
async, correlation/transaction id) se puedan ver y ejercitar de punta a
punta, más que tener cada feature de negocio completa.

## Estructura

```
frontend/    Next.js standalone (React Query + Zustand + Tailwind)
backend/     Workspace de pnpm — patrón Nest recomendado: apps/ + packages/
```

`frontend/` y `backend/` son proyectos independientes (cada uno con su propio
`package.json`/lockfile) — este repo es la "guía" para correr todo el
sistema junto durante el desarrollo. Cada carpeta bajo `backend/apps/` está
pensada para poder extraerse a su propio repo el día que un equipo se haga
cargo de ese servicio en particular.

Ver el [README del backend](backend/README.md) (microservicios, arquitectura
de eventos Kafka/RabbitMQ, patrón outbox, flujos clave) y el
[README del frontend](frontend/README.md) (stack, arquitectura del cliente,
páginas) para el detalle de cada proyecto.

Cada microservicio tiene su propio `CLAUDE.md` con el detalle de su
arquitectura interna. `backend/packages/event-contracts/src/topics.ts` es la
fuente de verdad del catálogo de eventos de Kafka y la topología de
RabbitMQ.

## Requisitos

- Node.js 22+
- pnpm 12+
- Docker Desktop (Postgres, Kafka, RabbitMQ, Redis vía docker-compose)

## Levantar todo en desarrollo

```bash
# 1. Infra (Postgres, Kafka, RabbitMQ, Redis)
cd backend
pnpm infra:up

# 2. Instalar dependencias
pnpm install                  # en backend/
cd ../frontend && pnpm install

# 3. Backend — cada servicio en su propia terminal
cd backend
pnpm --filter auth-service start:dev          # :3001
pnpm --filter catalog-service start:dev       # :3002
pnpm --filter cart-service start:dev          # :3003
pnpm --filter order-service start:dev         # :3004
pnpm --filter payment-service start:dev       # :3005
pnpm --filter bnpl-service start:dev          # :3006
pnpm --filter notification-service start:dev  # :3007
pnpm --filter api-gateway start:dev           # :3000

# 4. Seed de catálogo (una vez, con catalog-service ya conectado a su DB)
pnpm --filter catalog-service run seed

# 5. Frontend
cd ../frontend
pnpm dev                                      # :3100
```

Abrí `http://localhost:3100`.

## Apagar la infra

```bash
cd backend
pnpm infra:down
```
