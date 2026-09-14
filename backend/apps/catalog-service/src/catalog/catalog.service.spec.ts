import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CatalogService } from './catalog.service';
import { Category } from './entities/category.entity';
import { Product } from './entities/product.entity';

describe('CatalogService', () => {
  let service: CatalogService;
  let productsRepo: { findAndCount: jest.Mock; findOne: jest.Mock };
  let categoriesRepo: { find: jest.Mock };

  const category: Category = {
    id: 'cat-1',
    name: 'Electrónica',
    slug: 'electronica',
    products: [],
    createdAt: new Date(),
  };

  const product: Product = {
    id: 'prod-1',
    name: 'Auriculares',
    description: 'desc',
    priceCents: 1000,
    currency: 'USD',
    imageUrl: null,
    category,
    variants: [{ id: 'var-1', name: 'Negro', priceCents: 1000, stock: 5, product: {} as Product }],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    productsRepo = { findAndCount: jest.fn(), findOne: jest.fn() };
    categoriesRepo = { find: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        CatalogService,
        { provide: getRepositoryToken(Product), useValue: productsRepo },
        { provide: getRepositoryToken(Category), useValue: categoriesRepo },
      ],
    }).compile();

    service = module.get(CatalogService);
  });

  it('lists products paginated and maps them to DTOs', async () => {
    productsRepo.findAndCount.mockResolvedValue([[product], 1]);

    const result = await service.listProducts({ page: 1, pageSize: 20 });

    expect(result).toEqual({
      items: [
        {
          id: 'prod-1',
          name: 'Auriculares',
          description: 'desc',
          priceCents: 1000,
          currency: 'USD',
          imageUrl: null,
          category: { id: 'cat-1', name: 'Electrónica', slug: 'electronica' },
          variants: [{ id: 'var-1', name: 'Negro', priceCents: 1000, stock: 5 }],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    expect(productsRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 }),
    );
  });

  it('returns a product by id', async () => {
    productsRepo.findOne.mockResolvedValue(product);

    const result = await service.getProductById('prod-1');

    expect(result.id).toBe('prod-1');
  });

  it('throws NotFoundException when the product does not exist', async () => {
    productsRepo.findOne.mockResolvedValue(null);

    await expect(service.getProductById('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists categories mapped to DTOs', async () => {
    categoriesRepo.find.mockResolvedValue([category]);

    const result = await service.listCategories();

    expect(result).toEqual([{ id: 'cat-1', name: 'Electrónica', slug: 'electronica' }]);
  });
});
