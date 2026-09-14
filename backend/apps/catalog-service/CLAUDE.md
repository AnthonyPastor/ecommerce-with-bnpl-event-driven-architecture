# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this service is

`catalog-service` is one of the independently deployable NestJS microservices of the BNPL system (see the root `README.md`). It owns the product catalog: categories, products, and variants. It is read-mostly from the perspective of the rest of the system — nothing else writes to it, and it publishes no domain events (no outbox here, unlike order/payment/bnpl-service).

Routes are exposed "naked" (no `/catalog` prefix) — e.g. `GET /products`, not `GET /catalog/products`. The api-gateway is what adds the `/api/catalog` prefix when proxying, stripping both `/api` and `/catalog` before forwarding here.

## Commands

Run from `backend/` (the pnpm workspace root):

```bash
pnpm install                                   # once
pnpm --filter catalog-service start:dev        # dev server, port 3002 by default
pnpm --filter catalog-service build
pnpm --filter catalog-service test             # unit tests
pnpm --filter catalog-service test -- catalog.service.spec   # single file
pnpm --filter catalog-service test:e2e         # needs Postgres up, catalog_db created
pnpm --filter catalog-service run seed         # populates sample categories/products
```

Local infra: `docker compose -f backend/infra/docker-compose.yml up -d`.

## Architecture

- `src/catalog/entities/`: `Category`, `Product` (`ManyToOne` Category, `onDelete: 'SET NULL'`), `ProductVariant` (`ManyToOne` Product, `onDelete: 'CASCADE'`). Any nullable string column (e.g. `Product.imageUrl`) must have an explicit `type: 'varchar'` in its `@Column()` — without it, TypeORM's reflect-metadata infers `Object` and Postgres synchronize fails with `DataTypeNotSupportedError`.
- `src/catalog/catalog.service.ts` + `catalog.controller.ts`: pagination for `GET /products` is `skip`/`take` based; `GET /products/:id` throws `NotFoundException` for a 404.
- `src/seed.ts`: a standalone script (not part of the Nest app) using its own `DataSource` to idempotently insert sample data — safe to re-run.
- `AppModule` wires `TypeOrmModule.forRootAsync` with `synchronize: true` (dev-only, no migrations yet) and applies `CorrelationIdMiddleware` from `@bnpl/observability` globally, same as every other service in this monorepo.
