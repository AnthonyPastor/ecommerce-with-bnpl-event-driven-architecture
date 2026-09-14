import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoryDto, PaginatedProductsDto, ProductDto } from './dto/product.dto';
import { ListProductsQueryDto } from './dto/list-products.query.dto';
import { Category } from './entities/category.entity';
import { Product } from './entities/product.entity';

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(Category) private readonly categories: Repository<Category>,
  ) {}

  async listProducts(query: ListProductsQueryDto): Promise<PaginatedProductsDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const [items, total] = await this.products.findAndCount({
      where: query.categoryId ? { category: { id: query.categoryId } } : {},
      relations: { category: true, variants: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      items: items.map((product) => this.toProductDto(product)),
      total,
      page,
      pageSize,
    };
  }

  async getProductById(id: string): Promise<ProductDto> {
    const product = await this.products.findOne({
      where: { id },
      relations: { category: true, variants: true },
    });

    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }

    return this.toProductDto(product);
  }

  async listCategories(): Promise<CategoryDto[]> {
    const categories = await this.categories.find({ order: { name: 'ASC' } });
    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
    }));
  }

  private toProductDto(product: Product): ProductDto {
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      priceCents: product.priceCents,
      currency: product.currency,
      imageUrl: product.imageUrl,
      category: product.category
        ? { id: product.category.id, name: product.category.name, slug: product.category.slug }
        : null,
      variants: (product.variants ?? []).map((variant) => ({
        id: variant.id,
        name: variant.name,
        priceCents: variant.priceCents,
        stock: variant.stock,
      })),
    };
  }
}
