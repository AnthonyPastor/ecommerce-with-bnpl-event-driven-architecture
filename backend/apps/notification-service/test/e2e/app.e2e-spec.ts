import { randomUUID } from 'node:crypto';
import { KafkaTopics, buildEventEnvelope } from '@bnpl/event-contracts';
import { envelopeToHeaders } from '@bnpl/kafka-client';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Kafka } from 'kafkajs';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

// Assumes docker compose already ran (real Postgres on notification_db,
// real Kafka and RabbitMQ). Publishes a synthetic
// `order.order.created.v1` envelope directly to Kafka (same shape as
// order-service produces) and verifies the full pipeline: Kafka ->
// translator -> RabbitMQ -> ConsoleEmailProvider -> persisted NotificationLog.
describe('Notifications (e2e)', () => {
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

  it(
    'order.order.created.v1 ends up as a sent order_confirmation NotificationLog',
    async () => {
      const userId = `user-${randomUUID()}`;
      const orderId = `order-${randomUUID()}`;

      const envelope = buildEventEnvelope({
        eventType: KafkaTopics.order.created,
        aggregateType: 'Order',
        aggregateId: orderId,
        producer: 'order-service',
        correlationId: `corr-${randomUUID()}`,
        transactionId: orderId,
        payload: { orderId, userId, totalCents: 1500, currency: 'USD', items: [] },
      });

      const kafka = new Kafka({ clientId: 'notification-service-e2e-test', brokers: ['localhost:9092'] });
      const producer = kafka.producer();
      await producer.connect();
      await producer.send({
        topic: KafkaTopics.order.created,
        messages: [{ key: orderId, value: JSON.stringify(envelope), headers: envelopeToHeaders(envelope) }],
      });
      await producer.disconnect();

      let logs: any[] = [];
      for (let i = 0; i < 30 && logs.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 300));
        const res = await request(app.getHttpServer()).get(`/notifications?to=${userId}`).expect(200);
        logs = res.body;
      }

      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ to: userId, template: 'order_confirmation' });
      expect(logs[0].sentAt).not.toBeNull();
    },
    15000,
  );
});
