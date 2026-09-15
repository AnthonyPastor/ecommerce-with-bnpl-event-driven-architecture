import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Category } from './catalog/entities/category.entity';
import { Product } from './catalog/entities/product.entity';
import { ProductVariant } from './catalog/entities/product-variant.entity';

/**
 * Manual seed of sample data. Run with `pnpm --filter catalog-service run seed`
 * against the DB already started by docker-compose.
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
    { name: 'Electronics', slug: 'electronics' },
    { name: 'Apparel', slug: 'apparel' },
    { name: 'Home', slug: 'home' },
  ];

  const categories: Category[] = [];
  for (const data of categoriesData) {
    let category = await categoryRepo.findOne({ where: { slug: data.slug } });
    if (!category) {
      category = await categoryRepo.save(categoryRepo.create(data));
    }
    categories.push(category);
  }

  const [electronics, apparel, home] = categories;

  const productsData: Array<{
    name: string;
    description: string;
    priceCents: number;
    category: Category;
    imageUrl?: string;
    variants?: Array<{ name: string; priceCents: number; stock: number }>;
  }> = [
    {
      name: 'Bluetooth Headphones',
      description: 'Wireless headphones with noise cancellation.',
      priceCents: 8999,
      category: electronics,
      variants: [
        { name: 'Black', priceCents: 8999, stock: 25 },
        { name: 'White', priceCents: 8999, stock: 15 },
      ],
    },
    {
      name: 'Smartwatch Series 5',
      description: 'Smartwatch with heart-rate monitor.',
      priceCents: 19999,
      category: electronics,
      variants: [
        { name: '40mm', priceCents: 19999, stock: 10 },
        { name: '44mm', priceCents: 21999, stock: 8 },
      ],
    },
    {
      name: 'Portable Speaker',
      description: 'Water-resistant Bluetooth speaker.',
      priceCents: 5499,
      category: electronics,
    },
    {
      name: 'Basic T-Shirt',
      description: '100% cotton t-shirt.',
      priceCents: 2499,
      category: apparel,
      variants: [
        { name: 'S', priceCents: 2499, stock: 30 },
        { name: 'M', priceCents: 2499, stock: 40 },
        { name: 'L', priceCents: 2499, stock: 20 },
      ],
    },
    {
      name: 'Winter Jacket',
      description: 'Waterproof winter jacket.',
      priceCents: 12999,
      category: apparel,
      variants: [
        { name: 'M', priceCents: 12999, stock: 12 },
        { name: 'L', priceCents: 12999, stock: 9 },
      ],
    },
    {
      name: 'Urban Sneakers',
      description: 'Casual sneakers for everyday wear.',
      priceCents: 15999,
      category: apparel,
    },
    {
      name: 'Sheet Set',
      description: '100% cotton sheet set, full size.',
      priceCents: 7499,
      category: home,
    },
    {
      name: 'Electric Coffee Maker',
      description: '12-cup drip coffee maker.',
      priceCents: 10999,
      category: home,
      variants: [
        { name: 'Black', priceCents: 10999, stock: 18 },
        { name: 'Silver', priceCents: 11999, stock: 6 },
      ],
    },
  ];

  for (const data of productsData) {
    const existing = await productRepo.findOne({ where: { name: data.name } });
    if (existing) {
      continue;
    }

    const product = await productRepo.save(
      productRepo.create({
        name: data.name,
        description: data.description,
        priceCents: data.priceCents,
        category: data.category,
        imageUrl: data.imageUrl ?? null,
      }),
    );

    if (data.variants) {
      for (const variant of data.variants) {
        await variantRepo.save(variantRepo.create({ ...variant, product }));
      }
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
