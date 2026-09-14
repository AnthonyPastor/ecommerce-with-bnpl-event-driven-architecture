import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CategoryDto, PaginatedProductsDto, ProductDto } from './dto/product.dto';
import { ListProductsQueryDto } from './dto/list-products.query.dto';

@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('products')
  listProducts(@Query() query: ListProductsQueryDto): Promise<PaginatedProductsDto> {
    return this.catalogService.listProducts(query);
  }

  @Get('products/:id')
  getProduct(@Param('id') id: string): Promise<ProductDto> {
    return this.catalogService.getProductById(id);
  }

  @Get('categories')
  listCategories(): Promise<CategoryDto[]> {
    return this.catalogService.listCategories();
  }
}
