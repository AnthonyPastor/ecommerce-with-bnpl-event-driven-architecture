import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Category } from './catalog/entities/category.entity';
import { Product } from './catalog/entities/product.entity';
import { ProductVariant } from './catalog/entities/product-variant.entity';

/**
 * Manual seed of the Veloce shoe-store catalog. Run with
 * `pnpm --filter catalog-service run seed` against the DB already started by
 * docker-compose. Idempotent (matches by slug/name) — safe to re-run.
 *
 * To re-seed cleanly against a DB that already has the old generic sample
 * data (headphones, t-shirts, etc.), truncate `products`, `categories`, and
 * `product_variants` first — this is dev-only since `synchronize: true` is
 * already the deliberate DB strategy here, not a migration concern.
 */
async function seed() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    username: process.env.POSTGRES_USER ?? 'bnpl',
    password: process.env.POSTGRES_PASSWORD ?? 'bnpl',
    database: process.env.POSTGRES_DB ?? 'catalog_db',
    entities: [Product, Category, ProductVariant],
    synchronize: true,
  });

  await dataSource.initialize();

  const categoryRepo = dataSource.getRepository(Category);
  const productRepo = dataSource.getRepository(Product);
  const variantRepo = dataSource.getRepository(ProductVariant);

  const categoriesData = [
    { name: 'Running', slug: 'running' },
    { name: 'Lifestyle', slug: 'lifestyle' },
    { name: 'Trail', slug: 'trail' },
    { name: 'Court', slug: 'court' },
  ];

  const categoriesBySlug = new Map<string, Category>();
  for (const data of categoriesData) {
    let category = await categoryRepo.findOne({ where: { slug: data.slug } });
    if (!category) {
      category = await categoryRepo.save(categoryRepo.create(data));
    }
    categoriesBySlug.set(data.slug, category);
  }

  const SIZES = ['US 7', 'US 8', 'US 9', 'US 10', 'US 11', 'US 12'];

  const productsData: Array<{
    name: string;
    description: string;
    priceCents: number;
    categorySlug: string;
    stockOut: string[];
    isPro?: boolean;
  }> = [
    {
      name: 'Kinetic 1',
      description: 'Propulsion plate and high-rebound foam for fast training days.',
      priceCents: 13900,
      categorySlug: 'running',
      stockOut: ['US 7'],
    },
    {
      name: 'Kinetic Pro Carbon',
      description: 'Full carbon plate. Built for race day and track intervals.',
      priceCents: 22900,
      categorySlug: 'running',
      stockOut: ['US 12'],
      isPro: true,
    },
    {
      name: 'Kinetic Rebound',
      description: 'Stable cushioning for daily mileage.',
      priceCents: 16900,
      categorySlug: 'running',
      stockOut: [],
    },
    {
      name: 'Trace Court Low',
      description: 'Classic court silhouette in smooth leather.',
      priceCents: 9900,
      categorySlug: 'lifestyle',
      stockOut: ['US 8', 'US 11'],
    },
    {
      name: 'Trace Court High',
      description: 'High top with vulcanized rubber sole.',
      priceCents: 11900,
      categorySlug: 'lifestyle',
      stockOut: [],
    },
    {
      name: 'Pulse Street 90',
      description: 'Mesh and synthetic upper with visible air unit.',
      priceCents: 10900,
      categorySlug: 'lifestyle',
      stockOut: ['US 7'],
    },
    {
      name: 'Studio Knit Slip',
      description: 'Laceless knit build for all-day wear.',
      priceCents: 7900,
      categorySlug: 'lifestyle',
      stockOut: [],
    },
    {
      name: 'Drift Trail GTX',
      description: 'Waterproof membrane with 4 mm lugs.',
      priceCents: 17900,
      categorySlug: 'trail',
      stockOut: ['US 9'],
    },
    {
      name: 'Ridge Trail 2',
      description: 'Lightweight chassis for technical trails.',
      priceCents: 15900,
      categorySlug: 'trail',
      stockOut: [],
    },
    {
      name: 'Arena Court Pro',
      description: 'Reinforced lateral support for indoor court.',
      priceCents: 12900,
      categorySlug: 'court',
      stockOut: ['US 10'],
    },
  ];

  for (const data of productsData) {
    const isPro = data.isPro ?? false;
    const existing = await productRepo.findOne({ where: { name: data.name } });
    if (existing) {
      if (existing.isPro !== isPro) {
        existing.isPro = isPro;
        await productRepo.save(existing);
      }
      continue;
    }

    const product = await productRepo.save(
      productRepo.create({
        name: data.name,
        description: data.description,
        priceCents: data.priceCents,
        category: categoriesBySlug.get(data.categorySlug) ?? null,
        imageUrl: null,
        isPro,
      }),
    );

    for (const size of SIZES) {
      await variantRepo.save(
        variantRepo.create({
          product,
          name: size,
          priceCents: data.priceCents,
          stock: data.stockOut.includes(size) ? 0 : 6,
        }),
      );
    }
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
