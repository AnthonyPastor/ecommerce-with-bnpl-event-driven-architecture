# Frontend

Cliente ecommerce del sistema BNPL: catálogo, carrito, checkout, pago y seguimiento del plan de cuotas. Es un proyecto **standalone** (su propio `package.json`/lockfile, no forma parte del workspace de `backend/`) que habla con un único endpoint backend, el `api-gateway` — nunca llama a un microservicio directamente. Ver el [README de la raíz](../README.md) para el contexto general y el [README del backend](../backend/README.md) para la arquitectura de eventos detrás de cada pantalla.

## Tecnologías

- **Next.js 14** (App Router)
- **React Query** (`@tanstack/react-query`) — fetching, cache y polling de estado asíncrono
- **Zustand** — estado de autenticación, persistido en `localStorage`
- **Tailwind CSS**
- **Jest** + Testing Library (jsdom vía `next/jest`)

## Levantar el entorno

```bash
pnpm install
pnpm dev              # http://localhost:3100 (no 3000 — ese puerto es del api-gateway)
```

Necesita el `api-gateway` (y todo lo que hay detrás) corriendo y accesible en `NEXT_PUBLIC_API_BASE_URL` (`.env.local`, por defecto `http://localhost:3000/api`) — ver [backend/README.md](../backend/README.md) para levantar el stack completo.

```bash
pnpm build             # build de producción
pnpm test              # unitarios
pnpm test -- auth-store.test   # un solo archivo
```

## Arquitectura

### Un solo cliente API, sin fetch por feature

`lib/api-client.ts` es el único lugar que habla con el backend. Su helper interno `request()` agrega `Authorization: Bearer` automáticamente desde `useAuthStore.getState().accessToken` cuando la llamada pasa `auth: true` — los componentes nunca tocan headers a mano. Al agregar una llamada nueva al backend, se agrega un método a `apiClient` acá, no un `fetch` suelto en un componente.

### Estado de auth: Zustand + persist, leído imperativamente fuera de componentes

`store/auth-store.ts` guarda `{ accessToken, refreshToken, user }` y persiste a `localStorage` (middleware `persist` de Zustand). Los componentes lo leen reactivamente con el hook (`useAuthStore((s) => s.user)`); `lib/api-client.ts` lo lee de forma *imperativa* vía `useAuthStore.getState()` porque no es un componente. `setAuth(tokens, user)` / `clearAuth()` son los únicos mutadores.

### Login tiene una dependencia de orden

En `app/login/page.tsx` los tokens se escriben en el store *antes* de poder llamar al endpoint autenticado `/auth/me` (el token tiene que existir en el store primero, porque `api-client.ts` lo lee de ahí) — luego se llama `setAuth` de nuevo con tokens + usuario. Si se toca este flujo, hay que preservar ese orden.

### Polling de estado asíncrono (pago → captura → plan de cuotas)

El pago se confirma vía webhook asíncrono en el backend (ver [backend/README.md § Flujos clave](../backend/README.md#flujos-clave)), así que el frontend necesita hacer polling hasta ver el estado final. `app/orders/[id]/page.tsx` es la referencia: `refetchInterval` es una función del último dato visto por la query (`query.state.data?.status`), devuelve `false` al llegar a un estado terminal y `1000` (ms) en caso contrario. La query del plan de cuotas está gateada con `enabled: isCaptured` y deja de hacer polling apenas tiene datos (el plan no cambia de estado desde esta UI). Cualquier otra UI que necesite "esperar una transición async del backend" debería copiar este patrón en vez de inventar uno nuevo.

### La plata siempre está en centavos

Todo precio/monto que llega del backend es `*Cents` (entero). `lib/format.ts`'s `formatPrice(priceCents, currency)` (divide por 100, formatea con `Intl.NumberFormat` cacheado por moneda, locale `es-AR`) es el único lugar que debería hacer esa conversión — no dividir por 100 inline en otro lado.

## Páginas

| Ruta | Qué hace |
|---|---|
| `/` | Catálogo de productos |
| `/login`, `/register` | Autenticación |
| `/cart` | Ver/editar carrito, checkout |
| `/orders/[id]` | Estado del pago (con polling) y, una vez capturado, el plan de cuotas resultante |

Más detalle en [`CLAUDE.md`](./CLAUDE.md).
