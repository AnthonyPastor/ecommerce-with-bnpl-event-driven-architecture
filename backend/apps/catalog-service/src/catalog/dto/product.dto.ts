export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
}

export interface VariantDto {
  id: string;
  name: string;
  priceCents: number;
  stock: number;
}

export interface ProductDto {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  imageUrl: string | null;
  category: CategoryDto | null;
  variants: VariantDto[];
}

export interface PaginatedProductsDto {
  items: ProductDto[];
  total: number;
  page: number;
  pageSize: number;
}
