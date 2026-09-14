import { randomUUID } from 'node:crypto';
import { KafkaTopics, buildEventEnvelope } from '@bnpl/event-contracts';
import { envelopeToHeaders } from '@bnpl/kafka-client';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Kafka } from 'kafkajs';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Asume que `docker compose -f backend/infra/docker-compose.yml up -d` ya
// corrió (Postgres real en bnpl_db, Kafka real en localhost:9092). Este test
// NO depende de que payment-service esté corriendo: publica él mismo un
// envelope sintético de `payment.transaction.captured.v1` directo a Kafka,
// con la misma forma exacta que payment-service produce en la realidad.
describe('BnplController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  }, 20000);

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok', async () => {
    await request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
  });

  it('GET /installment-plans/:id returns 404 for an unknown plan', async () => {
    await request(app.getHttpServer()).get(`/installment-plans/${randomUUID()}`).expect(404);
  });

  it('GET /installment-plans without orderId or userId returns 400', async () => {
    await request(app.getHttpServer()).get('/installment-plans').expect(400);
  });

  it(
    'consuming payment.transaction.captured.v1 creates an ACTIVE plan with 3 installments summing the total',
    async () => {
      const orderId = `order-${randomUUID()}`;
      const transactionId = randomUUID();
      const correlationId = `corr-${randomUUID()}`;

      const envelope = buildEventEnvelope({
        eventType: KafkaTopics.payment.captured,
        aggregateType: 'Transaction',
        aggregateId: transactionId,
        producer: 'payment-service',
        correlationId,
        transactionId: orderId,
        payload: {
          transactionId,
          orderId,
          userId: 'user-1',
          amountCents: 3000,
          currency: 'USD',
        },
      });

      const kafka = new Kafka({ clientId: 'bnpl-service-e2e-test', brokers: ['localhost:9092'] });
      const producer = kafka.producer();
      await producer.connect();
      await producer.send({
        topic: KafkaTopics.payment.captured,
        messages: [
          { key: transactionId, value: JSON.stringify(envelope), headers: envelopeToHeaders(envelope) },
        ],
      });
      await producer.disconnect();

      let plans: any[] = [];
      for (let i = 0; i < 30 && plans.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 300));
        const res = await request(app.getHttpServer()).get(`/installment-plans?orderId=${orderId}`).expect(200);
        plans = res.body;
      }

      expect(plans).toHaveLength(1);
      const [plan] = plans;
      expect(plan).toMatchObject({ orderId, userId: 'user-1', status: 'ACTIVE', totalCents: 3000 });
      expect(plan.installments).toHaveLength(3);
      const sum = plan.installments.reduce((acc: number, i: any) => acc + i.amountCents, 0);
      expect(sum).toBe(3000);
    },
    15000,
  );
});
