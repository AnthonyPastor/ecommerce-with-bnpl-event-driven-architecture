import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

// Assumes `docker compose up` already started Postgres (catalog_db) — there is no separate test DB in this skeleton.
describe('CatalogService (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
      .expect(({ body }) => {
        expect(body).toEqual({ status: 'ok' });
      });
  });

  it('/categories (GET) returns an array', () => {
    return request(app.getHttpServer())
      .get('/categories')
      .expect(200)
      .expect(({ body }) => {
        expect(Array.isArray(body)).toBe(true);
      });
  });

  it('/products (GET) returns a paginated shape', () => {
    return request(app.getHttpServer())
      .get('/products?page=1&pageSize=5')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({
            items: expect.any(Array),
            total: expect.any(Number),
            page: 1,
            pageSize: 5,
          }),
        );
      });
  });
});
