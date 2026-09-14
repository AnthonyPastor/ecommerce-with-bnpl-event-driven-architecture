import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Category } from './catalog/entities/category.entity';
import { Product } from './catalog/entities/product.entity';
import { ProductVariant } from './catalog/entities/product-variant.entity';

/**
 * Seed manual de datos de ejemplo. Correr con `pnpm --filter catalog-service run seed`
 * contra la DB ya levantada por docker-compose.
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
    { name: 'Electrónica', slug: 'electronica' },
    { name: 'Indumentaria', slug: 'indumentaria' },
    { name: 'Hogar', slug: 'hogar' },
  ];

  const categories: Category[] = [];
  for (const data of categoriesData) {
    let category = await categoryRepo.findOne({ where: { slug: data.slug } });
    if (!category) {
      category = await categoryRepo.save(categoryRepo.create(data));
    }
    categories.push(category);
  }

  const [electronica, indumentaria, hogar] = categories;

  const productsData: Array<{
    name: string;
    description: string;
    priceCents: number;
    category: Category;
    imageUrl?: string;
    variants?: Array<{ name: string; priceCents: number; stock: number }>;
  }> = [
    {
      name: 'Auriculares Bluetooth',
      description: 'Auriculares inalámbricos con cancelación de ruido.',
      priceCents: 8999,
      category: electronica,
      variants: [
        { name: 'Negro', priceCents: 8999, stock: 25 },
        { name: 'Blanco', priceCents: 8999, stock: 15 },
      ],
    },
    {
      name: 'Smartwatch Serie 5',
      description: 'Reloj inteligente con monitor de ritmo cardíaco.',
      priceCents: 19999,
      category: electronica,
      variants: [
        { name: '40mm', priceCents: 19999, stock: 10 },
        { name: '44mm', priceCents: 21999, stock: 8 },
      ],
    },
    {
      name: 'Parlante Portátil',
      description: 'Parlante Bluetooth resistente al agua.',
      priceCents: 5499,
      category: electronica,
    },
    {
      name: 'Remera Básica',
      description: 'Remera de algodón 100%.',
      priceCents: 2499,
      category: indumentaria,
      variants: [
        { name: 'S', priceCents: 2499, stock: 30 },
        { name: 'M', priceCents: 2499, stock: 40 },
        { name: 'L', priceCents: 2499, stock: 20 },
      ],
    },
    {
      name: 'Campera de Abrigo',
      description: 'Campera impermeable para invierno.',
      priceCents: 12999,
      category: indumentaria,
      variants: [
        { name: 'M', priceCents: 12999, stock: 12 },
        { name: 'L', priceCents: 12999, stock: 9 },
      ],
    },
    {
      name: 'Zapatillas Urbanas',
      description: 'Zapatillas casuales para uso diario.',
      priceCents: 15999,
      category: indumentaria,
    },
    {
      name: 'Juego de Sábanas',
      description: 'Sábanas 100% algodón, plaza y media.',
      priceCents: 7499,
      category: hogar,
    },
    {
      name: 'Cafetera Eléctrica',
      description: 'Cafetera de filtro de 12 tazas.',
      priceCents: 10999,
      category: hogar,
      variants: [
        { name: 'Negra', priceCents: 10999, stock: 18 },
        { name: 'Plateada', priceCents: 11999, stock: 6 },
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
  console.log('Seed completo.');
  await dataSource.destroy();
}

seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Seed falló:', err);
  process.exit(1);
});
