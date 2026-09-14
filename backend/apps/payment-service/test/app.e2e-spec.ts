import { randomUUID } from 'node:crypto';
import { KafkaTopics } from '@bnpl/event-contracts';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Kafka } from 'kafkajs';
import request from 'supertest';

const E2E_PORT = 3015;

// Asume que `docker compose -f backend/infra/docker-compose.yml up -d` ya
// corrió (Postgres real en payment_db, Kafka real en localhost:9092, RabbitMQ
// real en localhost:5672). El FakePaymentGateway hace un self-loopback HTTP
// real a este mismo puerto para simular el webhook async del gateway — por
// eso este test necesita un puerto real escuchando (no alcanza con
// app.getHttpServer() de supertest sin listen()).
describe('PaymentsController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.PORT = String(E2E_PORT);
    process.env.PAYMENT_SERVICE_SELF_URL = `http://localhost:${E2E_PORT}`;
    process.env.FAKE_GATEWAY_CAPTURE_DELAY_MS = '500';
    process.env.POSTGRES_DB = 'payment_db';

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(E2E_PORT);
  }, 20000);

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok', async () => {
    await request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
  });

  it('GET /payments/:id returns 404 for an unknown transaction', async () => {
    await request(app.getHttpServer()).get(`/payments/${randomUUID()}`).expect(404);
  });

  it(
    'authorizes synchronously, then the FakePaymentGateway self-triggers a real webhook that moves it to CAPTURED',
    async () => {
      const correlationId = `corr-${randomUUID()}`;
      const orderId = `order-${randomUUID()}`;

      const createRes = await request(app.getHttpServer())
        .post('/payments')
        .set('x-correlation-id', correlationId)
        .send({ orderId, userId: 'user-1', amountCents: 4200, currency: 'USD' })
        .expect(201);

      expect(createRes.body).toMatchObject({ orderId, status: 'AUTHORIZED', amountCents: 4200 });
      const transactionId = createRes.body.id;

      // Poll hasta que el webhook async (disparado ~500ms después por el
      // propio FakeGateway) haya sido procesado vía RabbitMQ y la transacción
      // haya pasado a CAPTURED.
      let status = createRes.body.status;
      for (let i = 0; i < 20 && status !== 'CAPTURED'; i++) {
        await new Promise((r) => setTimeout(r, 300));
        const getRes = await request(app.getHttpServer()).get(`/payments/${transactionId}`).expect(200);
        status = getRes.body.status;
      }
      expect(status).toBe('CAPTURED');
    },
    15000,
  );

  it(
    'publishes both payment.transaction.authorized.v1 and captured.v1 to Kafka with correlationId/transactionId propagated',
    async () => {
      const correlationId = `corr-${randomUUID()}`;
      const orderId = `order-${randomUUID()}`;

      const createRes = await request(app.getHttpServer())
        .post('/payments')
        .set('x-correlation-id', correlationId)
        .send({ orderId, userId: 'user-2', amountCents: 999, currency: 'USD' })
        .expect(201);
      const transactionId = createRes.body.id;

      const kafka = new Kafka({ clientId: 'payment-service-e2e-test', brokers: ['localhost:9092'] });
      const consumer = kafka.consumer({ groupId: `e2e-test-${randomUUID()}` });
      await consumer.connect();
      // Topics recién auto-creados por el primer test de esta suite pueden
      // tardar un instante en propagar metadata en un broker single-node;
      // reintentamos el subscribe en vez de asumir que ya está listo.
      for (const topic of [KafkaTopics.payment.authorized, KafkaTopics.payment.captured]) {
        for (let attempt = 1; ; attempt++) {
          try {
            await consumer.subscribe({ topic, fromBeginning: true });
            break;
          } catch (err) {
            if (attempt >= 5) throw err;
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      }

      const seen = new Map<string, Record<string, unknown>>();
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 15000);
        consumer
          .run({
            eachMessage: async ({ message, topic }) => {
              const envelope = JSON.parse(message.value?.toString() ?? '{}');
              if (envelope.aggregateId === transactionId) {
                seen.set(topic, envelope);
                if (seen.has(KafkaTopics.payment.authorized) && seen.has(KafkaTopics.payment.captured)) {
                  clearTimeout(timeout);
                  resolve();
                }
              }
            },
          })
          .catch(() => resolve());
      });
      await consumer.disconnect();

      const authorizedEnvelope = seen.get(KafkaTopics.payment.authorized);
      const capturedEnvelope = seen.get(KafkaTopics.payment.captured);
      expect(authorizedEnvelope).toMatchObject({
        aggregateType: 'Transaction',
        aggregateId: transactionId,
        correlationId,
        transactionId: orderId,
      });
      expect(capturedEnvelope).toMatchObject({ aggregateType: 'Transaction', aggregateId: transactionId });
    },
    20000,
  );

  async function createAndWaitForCapture(userId: string, amountCents: number): Promise<string> {
    const orderId = `order-${randomUUID()}`;
    const createRes = await request(app.getHttpServer())
      .post('/payments')
      .send({ orderId, userId, amountCents, currency: 'USD' })
      .expect(201);
    const transactionId = createRes.body.id;

    let status = createRes.body.status;
    for (let i = 0; i < 20 && status !== 'CAPTURED'; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const getRes = await request(app.getHttpServer()).get(`/payments/${transactionId}`).expect(200);
      status = getRes.body.status;
    }
    expect(status).toBe('CAPTURED');
    return transactionId;
  }

  it(
    'a full refund (gateway.refund -> async webhook) moves the transaction to REFUNDED',
    async () => {
      const transactionId = await createAndWaitForCapture('user-refund-full', 5000);

      await request(app.getHttpServer()).post(`/payments/${transactionId}/refund`).send({}).expect(201);

      let status = 'CAPTURED';
      for (let i = 0; i < 20 && status !== 'REFUNDED'; i++) {
        await new Promise((r) => setTimeout(r, 300));
        const getRes = await request(app.getHttpServer()).get(`/payments/${transactionId}`).expect(200);
        status = getRes.body.status;
      }
      expect(status).toBe('REFUNDED');
    },
    15000,
  );

  it(
    'a partial refund moves the transaction to PARTIALLY_REFUNDED, and a second one covering the rest moves it to REFUNDED',
    async () => {
      const transactionId = await createAndWaitForCapture('user-refund-partial', 1000);

      await request(app.getHttpServer())
        .post(`/payments/${transactionId}/refund`)
        .send({ amountCents: 400 })
        .expect(201);

      let status = 'CAPTURED';
      for (let i = 0; i < 20 && status !== 'PARTIALLY_REFUNDED'; i++) {
        await new Promise((r) => setTimeout(r, 300));
        const getRes = await request(app.getHttpServer()).get(`/payments/${transactionId}`).expect(200);
        status = getRes.body.status;
      }
      expect(status).toBe('PARTIALLY_REFUNDED');

      await request(app.getHttpServer())
        .post(`/payments/${transactionId}/refund`)
        .send({ amountCents: 600 })
        .expect(201);

      for (let i = 0; i < 20 && status !== 'REFUNDED'; i++) {
        await new Promise((r) => setTimeout(r, 300));
        const getRes = await request(app.getHttpServer()).get(`/payments/${transactionId}`).expect(200);
        status = getRes.body.status;
      }
      expect(status).toBe('REFUNDED');
    },
    20000,
  );

  it('POST /payments/:id/refund rejects a transaction that is not CAPTURED yet', async () => {
    const orderId = `order-${randomUUID()}`;
    const createRes = await request(app.getHttpServer())
      .post('/payments')
      .send({ orderId, userId: 'user-x', amountCents: 1000, currency: 'USD' })
      .expect(201); // status AUTHORIZED, not yet CAPTURED
    await request(app.getHttpServer())
      .post(`/payments/${createRes.body.id}/refund`)
      .send({})
      .expect(400);
  });

  it('POST /payments/:id/void cancels an AUTHORIZED (not yet captured) transaction synchronously', async () => {
    const orderId = `order-${randomUUID()}`;
    const createRes = await request(app.getHttpServer())
      .post('/payments')
      .send({ orderId, userId: 'user-void', amountCents: 1000, currency: 'USD' })
      .expect(201);

    const voidRes = await request(app.getHttpServer())
      .post(`/payments/${createRes.body.id}/void`)
      .expect(201);
    expect(voidRes.body.status).toBe('VOIDED');
  });

  it('POST /payments/:id/simulate-chargeback drives CAPTURED -> DISPUTED -> CHARGEBACK', async () => {
    const transactionId = await createAndWaitForCapture('user-chargeback', 1000);

    const res = await request(app.getHttpServer())
      .post(`/payments/${transactionId}/simulate-chargeback`)
      .expect(201);
    expect(res.body.status).toBe('CHARGEBACK');
  });
});
