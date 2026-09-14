import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Asume que `docker compose up` ya levantó Postgres (cart_db) — no hay DB de test separada en este skeleton.
describe('CartService (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/health (GET) returns ok', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ status: 'ok' }));
  });

  it('GET /cart creates and returns an empty cart for a new userId', async () => {
    const userId = randomUUID();
    const res = await request(app.getHttpServer()).get(`/cart?userId=${userId}`).expect(200);
    expect(res.body).toMatchObject({ userId, status: 'ACTIVE', items: [], totalCents: 0 });
  });

  it('POST /cart/items adds an item and computes the total correctly', async () => {
    const userId = randomUUID();
    const res = await request(app.getHttpServer())
      .post('/cart/items')
      .send({ userId, productId: 'prod-1', name: 'Widget', unitPriceCents: 1500, quantity: 3 })
      .expect(201);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.totalCents).toBe(4500);
  });

  // El checkout end-to-end (cart-service -> order-service real) requiere order-service
  // corriendo, lo cual está fuera del alcance de este e2e por servicio — se cubre en
  // la suite backend/e2e/ de sistema (Fase 6 del plan), que levanta todos los servicios.
  it.skip('POST /cart/checkout forwards to order-service (covered by backend/e2e/ system suite)', () => {});
});
