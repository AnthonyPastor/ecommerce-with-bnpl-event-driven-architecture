# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this service is

`auth-service` is one of the independently deployable NestJS microservices of the BNPL system (see the root `README.md` for the full architecture). It owns user identity: registration, login, JWT access/refresh tokens, and session revocation. It does **not** know about carts, orders, payments, or credit — other services trust its issued JWTs.

This folder is self-contained and can be extracted to its own repository at any point (see `../../README.md` for the multi-repo migration path). It depends on two workspace packages: `@bnpl/observability` (correlation-id middleware + structured logging) and, indirectly, the pnpm workspace root at `backend/`.

## Commands

Run all commands from `backend/` (the pnpm workspace root), not from this folder, unless noted.

```bash
# install (once, from backend/)
pnpm install

# dev server (this service only), reads .env in this folder (copy from .env.example)
pnpm --filter auth-service start:dev

# build
pnpm --filter auth-service build

# unit tests
pnpm --filter auth-service test
# single test file
pnpm --filter auth-service test -- auth.service.spec

# e2e tests — needs Postgres reachable (docker compose up -d from backend/infra/) and auth_db created
pnpm --filter auth-service test:e2e
```

Local infra (Postgres) is started via `docker compose -f backend/infra/docker-compose.yml up -d`. This service listens on port `3001` by default (`PORT` env var).

## Architecture

### Repository pattern for token issuance

`TokenProviderPort` (`src/auth/ports/token-provider.port.ts`) is an abstract class defining the token contract (`issueAccessToken`, `issueRefreshToken`, `verifyAccessToken`, `rotateRefreshToken`). It is **stateless/pure crypto** — it never touches the database. The only implementation today is `JwtTokenProvider` (`src/auth/providers/jwt-token.provider.ts`), which signs/verifies JWTs with two separate secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`). A future Auth0/Keycloak/Cognito adapter would implement the same port and be swapped in via the `AUTH_TOKEN_PROVIDER` DI token in `auth.module.ts` — no other code changes.

`AuthService` (`src/auth/auth.service.ts`) owns everything the port intentionally does *not*: it persists a hash (SHA-256, not the raw token) of each issued refresh token in the `refresh_tokens` table so tokens can be revoked/rotated and reuse detected. On `refresh()`, the old row is marked revoked in the same call that issues + persists the new one; a second attempt to use an already-revoked refresh token fails with 401. This split (port = crypto only, service = persistence/revocation) is deliberate — keep new logic on the correct side of it.

### Request correlation

`AppModule` applies `CorrelationIdMiddleware` (from `@bnpl/observability`) globally in `configure()`. It reads/generates `x-correlation-id` and stores it in an `AsyncLocalStorage`-backed `RequestContextService`, which `nestjs-pino` reads via a `mixin()` to stamp every log line automatically — you never need to thread correlationId through method signatures manually.

### Guard vs. controller responsibility

`JwtAuthGuard` (`src/auth/guards/jwt-auth.guard.ts`) only verifies the access token and attaches `req.user`; it has no knowledge of refresh tokens or the database. `/auth/logout` and `/auth/me` use it; `/auth/register`, `/auth/login`, `/auth/refresh` are intentionally unguarded (refresh proves itself via the refresh token in the body, not a bearer header).
