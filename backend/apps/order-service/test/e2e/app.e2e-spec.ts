import { randomUUID } from 'node:crypto';
import { KafkaTopics } from '@bnpl/event-contracts';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Kafka } from 'kafkajs';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

// Assumes `docker compose -f backend/infra/docker-compose.yml up -d` has
// already run (real Postgres on order_db + real Kafka on localhost:9092).
describe('OrdersController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok', async () => {
    await request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
  });

  it('creates an order, computes the total, and it is retrievable by id and by userId', async () => {
    const userId = `user-${randomUUID()}`;
    const createRes = await request(app.getHttpServer())
      .post('/orders')
      .send({
        userId,
        items: [
          { productId: 'p1', name: 'Product 1', unitPriceCents: 1000, quantity: 2 },
          { productId: 'p2', variantId: 'v1', name: 'Product 2', unitPriceCents: 500, quantity: 1 },
        ],
      })
      .expect(201);

    expect(createRes.body).toMatchObject({ userId, status: 'CREATED', totalCents: 2500, currency: 'USD' });
    expect(createRes.body.items).toHaveLength(2);
    const orderId = createRes.body.id;

    const getRes = await request(app.getHttpServer()).get(`/orders/${orderId}`).expect(200);
    expect(getRes.body.id).toBe(orderId);

    const listRes = await request(app.getHttpServer()).get(`/orders?userId=${userId}`).expect(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].id).toBe(orderId);
  });

  it('GET /orders/:id returns 404 for an unknown order', async () => {
    await request(app.getHttpServer()).get(`/orders/${randomUUID()}`).expect(404);
  });

  it('publishes order.order.created.v1 to Kafka via the outbox pattern, with correlationId propagated', async () => {
    const correlationId = `corr-${randomUUID()}`;
    const userId = `user-${randomUUID()}`;

    const createRes = await request(app.getHttpServer())
      .post('/orders')
      .set('x-correlation-id', correlationId)
      .send({ userId, items: [{ productId: 'p1', name: 'Product 1', unitPriceCents: 999, quantity: 1 }] })
      .expect(201);
    const orderId = createRes.body.id;

    const kafka = new Kafka({ clientId: 'order-service-e2e-test', brokers: ['localhost:9092'] });
    const consumer = kafka.consumer({ groupId: `e2e-test-${randomUUID()}` });
    await consumer.connect();
    await consumer.subscribe({ topic: KafkaTopics.order.created, fromBeginning: true });

    const found = await new Promise<Record<string, unknown> | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 15000);
      consumer
        .run({
          eachMessage: async ({ message }) => {
            const envelope = JSON.parse(message.value?.toString() ?? '{}');
            if (envelope.aggregateId === orderId) {
              clearTimeout(timeout);
              resolve(envelope);
            }
          },
        })
        .catch(() => resolve(null));
    });
    await consumer.disconnect();

    expect(found).not.toBeNull();
    expect(found).toMatchObject({
      eventType: KafkaTopics.order.created,
      aggregateType: 'Order',
      aggregateId: orderId,
      correlationId,
      transactionId: orderId,
    });
  }, 20000);
});
