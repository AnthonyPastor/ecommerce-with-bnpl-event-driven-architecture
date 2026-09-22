import { randomUUID } from 'node:crypto';
import { InstallmentStatus, KafkaTopics, buildEventEnvelope } from '@bnpl/event-contracts';
import { envelopeToHeaders } from '@bnpl/kafka-client';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { Kafka } from 'kafkajs';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { CreditProfile } from '../../src/bnpl/entities/credit-profile.entity';
import { Installment } from '../../src/bnpl/entities/installment.entity';
import { PollDueInstallmentsUseCase } from '../../src/bnpl/use-cases/poll-due-installments.use-case';

// Assumes `docker compose -f backend/infra/docker-compose.yml up -d` has
// already run (real Postgres on bnpl_db, real Kafka on localhost:9092). This
// test does NOT depend on payment-service running: it publishes a synthetic
// `payment.transaction.captured.v1` envelope directly to Kafka itself, with
// the exact same shape that payment-service produces in reality.
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

  /** Publishes a synthetic envelope directly to Kafka, same technique as the test above. */
  async function publishSyntheticEvent(
    eventType: string,
    aggregateId: string,
    orderId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const envelope = buildEventEnvelope({
      eventType,
      aggregateType: 'Transaction',
      aggregateId,
      producer: 'payment-service',
      correlationId: `corr-${randomUUID()}`,
      transactionId: orderId,
      payload,
    });

    const kafka = new Kafka({ clientId: 'bnpl-service-e2e-test', brokers: ['localhost:9092'] });
    const producer = kafka.producer();
    await producer.connect();
    await producer.send({
      topic: eventType,
      messages: [{ key: aggregateId, value: JSON.stringify(envelope), headers: envelopeToHeaders(envelope) }],
    });
    await producer.disconnect();
  }

  async function createActivePlan(orderId: string): Promise<void> {
    await publishSyntheticEvent(KafkaTopics.payment.captured, randomUUID(), orderId, {
      transactionId: randomUUID(),
      orderId,
      userId: 'user-1',
      amountCents: 3000,
      currency: 'USD',
    });

    for (let i = 0; i < 30; i++) {
      const res = await request(app.getHttpServer()).get(`/installment-plans?orderId=${orderId}`).expect(200);
      if (res.body.length > 0) return;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`Plan for order ${orderId} was never created`);
  }

  it(
    'the hourly poller marks a due installment DUE and publishes bnpl.installment.due.v1',
    async () => {
      const orderId = `order-${randomUUID()}`;
      await createActivePlan(orderId);

      const plansRes = await request(app.getHttpServer()).get(`/installment-plans?orderId=${orderId}`).expect(200);
      const firstInstallmentId = plansRes.body[0].installments[0].id;

      // Backdate the first installment so the poller picks it up — there's
      // no HTTP endpoint for this (installments only get real future due
      // dates from ActivateInstallmentPlanUseCase), so go straight to the DB.
      const installments = app.get(getRepositoryToken(Installment));
      await installments.update({ id: firstInstallmentId }, { dueDate: new Date(Date.now() - 60000) });

      await app.get(PollDueInstallmentsUseCase).execute();

      const updatedRes = await request(app.getHttpServer()).get(`/installment-plans?orderId=${orderId}`).expect(200);
      const updated = updatedRes.body[0].installments.find((i: any) => i.id === firstInstallmentId);
      expect(updated.status).toBe(InstallmentStatus.DUE);
    },
    20000,
  );

  it(
    'three consecutive installment_charge.capture_failed.v1 events DEFAULT the installment and block the credit profile',
    async () => {
      const orderId = `order-${randomUUID()}`;
      await createActivePlan(orderId);

      const plansRes = await request(app.getHttpServer()).get(`/installment-plans?orderId=${orderId}`).expect(200);
      const installmentId = plansRes.body[0].installments[0].id;

      for (let attempt = 1; attempt <= 3; attempt++) {
        await publishSyntheticEvent(KafkaTopics.payment.installmentChargeFailed, randomUUID(), orderId, {
          transactionId: randomUUID(),
          installmentId,
          orderId,
          userId: 'user-1',
        });

        const expectedStatus = attempt < 3 ? InstallmentStatus.PENDING : InstallmentStatus.DEFAULTED;
        let status: string | undefined;
        for (let i = 0; i < 30; i++) {
          const res = await request(app.getHttpServer()).get(`/installment-plans?orderId=${orderId}`).expect(200);
          status = res.body[0].installments.find((inst: any) => inst.id === installmentId)?.status;
          if (status === expectedStatus) break;
          await new Promise((r) => setTimeout(r, 300));
        }
        expect(status).toBe(expectedStatus);
      }

      const creditProfiles = app.get(getRepositoryToken(CreditProfile));
      const profile = await creditProfiles.findOne({ where: { userId: 'user-1' } });
      expect(profile?.blocked).toBe(true);
    },
    30000,
  );
});
