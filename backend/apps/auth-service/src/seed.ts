import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { RefreshToken } from './auth/entities/refresh-token.entity';
import { User } from './auth/entities/user.entity';

/**
 * Manual seed of a test user. Run with `pnpm --filter auth-service run seed`
 * against the DB already started by docker-compose.
 */
async function seed() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    username: process.env.POSTGRES_USER ?? 'bnpl',
    password: process.env.POSTGRES_PASSWORD ?? 'bnpl',
    database: process.env.POSTGRES_DB ?? 'auth_db',
    entities: [User, RefreshToken],
    synchronize: true,
  });

  await dataSource.initialize();

  const userRepo = dataSource.getRepository(User);

  const testUser = {
    email: 'test@mail.com',
    password: 'password123!',
    name: 'Test User',
  };

  const existing = await userRepo.findOne({ where: { email: testUser.email } });
  if (!existing) {
    const passwordHash = await bcrypt.hash(testUser.password, 10);
    await userRepo.save(
      userRepo.create({ email: testUser.email, passwordHash, name: testUser.name }),
    );
  }

  // eslint-disable-next-line no-console
  console.log('Seed complete.');
  await dataSource.destroy();
}

seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Seed failed:', err);
  process.exit(1);
});
