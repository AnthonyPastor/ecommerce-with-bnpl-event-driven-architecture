import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Asume que `docker compose -f backend/infra/docker-compose.yml up -d` ya
// corrió (necesita Postgres real en localhost:5432, DB `auth_db`) — no hay
// una DB de test separada en este skeleton.
describe('AuthController (e2e)', () => {
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

  it('supports register -> login -> me -> refresh -> logout', async () => {
    const email = `e2e-${randomUUID()}@bnpl.test`;
    const password = 'super-secret-pw';

    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, name: 'E2E User' })
      .expect(201);
    expect(registerRes.body).toMatchObject({ email, name: 'E2E User' });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    expect(loginRes.body.accessToken).toEqual(expect.any(String));
    expect(loginRes.body.refreshToken).toEqual(expect.any(String));

    const { accessToken, refreshToken } = loginRes.body;

    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(meRes.body).toMatchObject({ email, name: 'E2E User' });

    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(201);
    expect(refreshRes.body.refreshToken).not.toBe(refreshToken);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken: refreshRes.body.refreshToken })
      .expect(204);

    // El refresh token ya deslogueado no debería poder usarse de nuevo.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: refreshRes.body.refreshToken })
      .expect(401);
  });

  it('rejects login with wrong password', async () => {
    const email = `e2e-${randomUUID()}@bnpl.test`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'correct-password', name: 'X' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401);
  });

  it('rejects /auth/me without a bearer token', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });
});
