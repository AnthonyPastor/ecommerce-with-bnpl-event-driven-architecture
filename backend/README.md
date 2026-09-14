# Backend

Backend del sistema BNPL: 8 microservicios NestJS independientes + un API gateway, coordinados por eventos (Kafka) y comandos (RabbitMQ), cada uno con su propia base de datos PostgreSQL. Ver el [README de la raíz](../README.md) para el contexto general del proyecto y el [README del frontend](../frontend/README.md) para el cliente.

## Tecnologías

- **NestJS** (uno por microservicio, `pnpm` workspace con `apps/*` + `packages/*`)
- **PostgreSQL 16** — una base por servicio (excepto `api-gateway`, que no tiene estado)
- **Apache Kafka 3.8.0** en modo **KRaft** (sin Zookeeper) — eventos de dominio inmutables
- **RabbitMQ 3** — comandos/tareas punto a punto con retry + dead-letter queue
- **Redis** — reservado para infraestructura (cache/rate-limit), no en uso crítico todavía
- **TypeORM** (`synchronize: true`, sin migraciones — es un proyecto de aprendizaje, no producción)
- **nestjs-pino** para logging estructurado, con correlation/transaction id inyectados automáticamente
- **Jest** (unitarios por servicio + e2e por servicio + suite e2e cross-service)
- **Docker Compose** para toda la infraestructura local

## Microservicios

| Servicio | Puerto | Base de datos | Responsabilidad |
|---|---|---|---|
| `api-gateway` | 3000 | — | Único punto de entrada del frontend. Verifica JWT, agrega/propaga `x-correlation-id`, hace reverse proxy. Sin lógica de negocio. |
| `auth-service` | 3001 | `auth_db` | Identidad: registro, login, JWT access/refresh, revocación de sesiones. |
| `catalog-service` | 3002 | `catalog_db` | Catálogo: categorías, productos, variantes. Solo lectura para el resto del sistema. |
| `cart-service` | 3003 | `cart_db` | Carrito de compras y checkout (llamada síncrona a `order-service`). |
| `order-service` | 3004 | `order_db` | Órdenes: creación, y reacción a reembolsos. Es donde nace el `transactionId` de negocio. |
| `payment-service` | 3005 | `payment_db` | Máquina de estados de pago, abstracción del gateway, pipeline de webhooks asíncrono. El servicio más complejo. |
| `bnpl-service` | 3006 | `bnpl_db` | Lógica "buy now, pay later": scoring de crédito, planes de cuotas, reacción al ciclo de vida del pago. |
| `notification-service` | 3007 | `notification_db` | Puente eventos de dominio → email (Kafka → RabbitMQ → envío). |

Cada carpeta bajo `apps/` está pensada para poder extraerse a su propio repo — no hay imports cruzados entre servicios; todo lo compartido vive en `packages/*`.

## Levantar el entorno

```bash
pnpm install
pnpm infra:up                                   # Postgres, Kafka, RabbitMQ, Redis, Adminer
pnpm --filter <service> start:dev                # una terminal por servicio
pnpm --filter catalog-service run seed           # una vez, con catalog-service arriba
```

Ver comandos completos (tests, build, filtros) en [`CLAUDE.md`](./CLAUDE.md).

## Arquitectura de eventos

El sistema usa **dos mecanismos de mensajería con garantías distintas a propósito**:

- **Kafka = hechos inmutables.** Un evento de dominio (`order.created`, `payment.captured`, etc.) representa algo que *ya pasó* — es un log de auditoría del que otros servicios pueden reaccionar, y del que se podría reconstruir el estado del sistema. Nunca se reintenta "el pedido" en sí — el hecho ya ocurrió.
- **RabbitMQ = comandos/tareas.** Una instrucción de "hacé esto" (enviar un email, procesar un webhook, cobrar una cuota) que necesita reintentos con backoff y una dead-letter queue si falla definitivamente — semántica de cola de trabajo, no de log.

### Patrón Outbox (cómo se publica en Kafka sin inconsistencia)

Publicar directo a Kafka dentro de una transacción de base de datos no es atómico (la DB y Kafka son dos sistemas distintos) — si el commit de la DB falla después de publicar, o el publish falla después del commit, el estado queda inconsistente. Se resuelve con el **patrón outbox** (`@bnpl/outbox`):

1. El servicio guarda la entidad de dominio *y* una fila en `outbox_event` en la **misma transacción** de Postgres (`saveWithOutbox(queryRunner, entity, event)`).
2. `OutboxPublisherService` (un poller separado, desacoplado del request HTTP) lee filas no publicadas y las envía a Kafka.

Esto garantiza que todo evento que Kafka termina viendo corresponde a un cambio que realmente se persistió — nunca al revés. La implementación de referencia es `OrdersService.createOrder()` en `apps/order-service`.

### Catálogo de eventos Kafka (`packages/event-contracts/src/topics.ts`)

| Tópico | Productor | Consumidores |
|---|---|---|
| `order.order.created.v1` | order-service | notification-service |
| `order.order.confirmed.v1` / `cancelled.v1` | order-service | — (definidos, sin flujo que los dispare aún) |
| `order.order.refunded.v1` | order-service | — |
| `payment.transaction.authorized.v1` / `.captured.v1` | payment-service | bnpl-service (captured → activa plan de cuotas) |
| `payment.transaction.authorization_failed.v1` / `.capture_failed.v1` | payment-service | — |
| `payment.transaction.voided.v1` / `.cancelled.v1` | payment-service | — |
| `payment.transaction.partially_refunded.v1` | payment-service | bnpl-service (ajusta plan) |
| `payment.transaction.refunded.v1` | payment-service | order-service (marca orden), bnpl-service (cancela plan), notification-service (email) |
| `payment.transaction.dispute_opened.v1` | payment-service | — |
| `payment.transaction.chargeback_received.v1` | payment-service | bnpl-service (pone el plan en hold + flag de re-scoring) |
| `bnpl.installment_plan.created.v1` / `.activated.v1` / `.adjusted.v1` / `.cancelled.v1` | bnpl-service | — |
| `bnpl.installment.due.v1` / `.paid.v1` / `.overdue.v1` / `.defaulted.v1` | bnpl-service (definidos) | notification-service (`due.v1`) |
| `cart.cart.checked_out.v1` | — (diferido; ver abajo) | — |
| `auth.user.registered.v1` | — (diferido) | — |

Naming: `<dominio>.<entidad>.<evento>.v1`.

### Topología RabbitMQ (`packages/event-contracts/src/topics.ts` → `RabbitMqTopology`)

Exchange `commands` con routing keys/colas dedicadas, cada una con retry + DLQ vía `bindRetryTopology()` (`@bnpl/rabbitmq-client`): cola principal → `retry.<queue>` (con TTL, dead-letter de vuelta a la principal) → `dlq.<queue>` tras agotar reintentos.

| Cola | Publica | Consume | Propósito |
|---|---|---|---|
| `q.notifications.email.send` | notification-service (desde el puente Kafka→RabbitMQ) | notification-service | Envío de email desacoplado de la traducción del evento. |
| `q.payments.webhook.process` | payment-service (`WebhooksController`) | payment-service (`WebhookProcessorConsumer`) | No bloquear la respuesta HTTP al gateway de pago mientras se escribe en DB. |
| `q.payments.charge_installment` | — (definida, sin publisher aún) | — | Ver "Gap conocido" abajo. |
| `q.documents.generate_contract` | — (definida, sin flujo aún) | — | Reservada. |

### Correlation ID vs. Transaction ID

- **`correlationId`**: uno por request HTTP. Generado/leído por `CorrelationIdMiddleware` (`@bnpl/observability`) en cada servicio, guardado en un `AsyncLocalStorage` (`RequestContextService`), inyectado automáticamente en cada línea de log (pino `mixin()`) y propagado automáticamente en llamadas HTTP salientes (`PropagatingHttpService`) y en headers de mensajes Kafka/RabbitMQ. Nunca se pasa a mano por parámetros de función.
- **`transactionId`**: identifica un flujo de *negocio* (en la práctica, siempre `order.id`) y sobrevive a través de requests HTTP no relacionados entre sí. `order-service` lo "crea" (`requestContext.setTransactionId(order.id)`) justo después de `createOrder()`. Un webhook de pago llega como un request HTTP nuevo (con su propio `correlationId` nuevo) — `payment-service` recupera el `transactionId` correcto buscando la fila de `Transaction`/`orderId` en su propia base, **nunca confiando en un header entrante** para esto.

Esto permite trazar un flujo de negocio completo (checkout → pago → webhook async → reembolso) a través de logs de distintos servicios y distintos requests HTTP, usando el mismo `transactionId`.

## Flujos clave

### 1. Checkout → pago síncrono → outbox → cuotas (happy path)

```
frontend → api-gateway → cart-service (checkout, HTTP síncrono con PropagatingHttpService)
                             → order-service.createOrder()
                                  → saveWithOutbox(Order + outbox_event) en una transacción
                                  → OutboxPublisherService publica order.order.created.v1 a Kafka (async)
frontend → api-gateway → payment-service.createPayment() → PaymentGatewayPort.authorize() (síncrono, fake gateway)
                             → applyTransition(PENDING → AUTHORIZED) → outbox → payment.transaction.authorized.v1
```

### 2. Webhook asíncrono de captura (por qué el pago no termina en el mismo request)

`FakePaymentGateway.authorize()` programa una llamada HTTP real de vuelta a `payment-service` (`/webhooks/payments/fake`) después de un delay, firmada con HMAC — simula un gateway real que confirma la captura fuera de banda:

```
FakeGateway (delay) → POST /webhooks/payments/fake
  → WebhooksController: verifica firma, chequea idempotencia (UNIQUE gateway+externalEventId),
    persiste el evento crudo, publica comando a RabbitMQ (q.payments.webhook.process), responde 200 YA
  → WebhookProcessorConsumer (async, con retry/DLQ) → PaymentsService.processWebhookEvent()
      → applyTransition(AUTHORIZED → CAPTURED) → outbox → payment.transaction.captured.v1
          → bnpl-service consume: crea el plan de cuotas (3 cuotas, scoring stub siempre aprueba)
```

La indirección HTTP → RabbitMQ → DB existe para no bloquear la respuesta al gateway de pago mientras se escribe en la base, y para obtener reintentos gratis si la escritura falla.

### 3. Reembolso (total o parcial)

```
POST /payments/:id/refund (amountCents opcional — omitido = reembolsa todo lo que quede)
  → PaymentsService.refundPayment() → PaymentGatewayPort.refund()
  → applyTransition(CAPTURED|PARTIALLY_REFUNDED → PARTIALLY_REFUNDED|REFUNDED, según cubra el total)
      → outbox → payment.transaction.refunded.v1 | .partially_refunded.v1
          → order-service consume .refunded.v1: OrdersService.markRefunded() (idempotente)
          → bnpl-service consume: cancela cuotas pendientes o las reescala proporcionalmente
          → notification-service consume .refunded.v1: envía email
```

### 4. Chargeback (no pasa por el gateway)

Un chargeback real lo inicia la red de tarjetas, no el merchant — `simulateChargeback()` no llama a `PaymentGatewayPort`, dispara dos transiciones directas: `CAPTURED → DISPUTED` (`dispute_opened.v1`) → `DISPUTED → CHARGEBACK` (`chargeback_received.v1`). `bnpl-service` reacciona poniendo el plan en `DISPUTED_HOLD` y marcando el perfil de crédito para re-scoring — sin publicar ningún evento nuevo propio.

### 5. Notificaciones: Kafka → RabbitMQ → email (dos saltos a propósito)

`notification-service` separa la *traducción* del evento de dominio (Kafka → comando `email.send`, sin retry, lógica pura y testeable) de la *entrega* (consumer de RabbitMQ con retry/DLQ que llama a `EmailProviderPort`). Mantiene el mapeo evento→email desacoplado de las preocupaciones de reintento/entrega.

## Patrón Repository (proveedores externos intercambiables)

Cada integración externa es una clase abstracta (contrato) + un token de DI + una implementación fake, seleccionada por variable de entorno en un factory provider — cambiar de proveedor real no toca código consumidor:

| Puerto | Servicio | Implementación actual | Futuro real |
|---|---|---|---|
| `PaymentGatewayPort` | payment-service | `FakePaymentGateway` | MercadoPago, PayPal |
| `EmailProviderPort` | notification-service | `ConsoleEmailProvider` (solo loguea) | SendGrid, SES |
| `TokenProviderPort` | auth-service | `JwtTokenProvider` | Auth0, Keycloak, Cognito |

## Gaps conocidos (deferidos a propósito, no bugs)

- **Cobro de cuotas ("dunning")**: `bnpl-service` crea `Installment`s con fechas de vencimiento reales, pero no hay un job que las cobre al vencer. La cola `q.payments.charge_installment` está definida pero nada la publica/consume todavía. Ver `apps/bnpl-service/CLAUDE.md`.
- **`cart.cart.checked_out.v1`** y **`auth.user.registered.v1`**: tópicos definidos en el catálogo, sin publisher todavía.
- **notification-service usa `userId` como "email destino"**: ningún evento de dominio consumido trae un email real, solo `userId`. Ver `apps/notification-service/CLAUDE.md`.

## Testing

- Unitarios por servicio: `pnpm --filter <service> test`.
- E2E por servicio: `pnpm --filter <service> test:e2e` (cada uno levanta su propia infra vía Docker Compose; algunos, como `bnpl-service`, publican eventos sintéticos directo a Kafka para no depender de otros servicios arriba).
- E2E cross-service: `backend/e2e/` (`pnpm test:e2e` desde `backend/`) — ejercita el sistema completo (happy path y reembolso) contra todos los servicios reales corriendo juntos.

Más detalle de arquitectura por servicio en el `CLAUDE.md` de cada uno bajo `apps/`.
