'use client';

import { useQuery } from '@tanstack/react-query';
import { ProductCard } from '../components/ProductCard';
import { apiClient } from '../lib/api-client';

export default function HomePage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['products'],
    queryFn: () => apiClient.getProducts({ page: 1, pageSize: 20 }),
  });

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading catalog...</p>;
  }

  if (isError || !data) {
    return (
      <p className="text-sm text-red-600">
        We couldn&apos;t load the catalog. Please try again later.
      </p>
    );
  }

  if (data.items.length === 0) {
    return <p className="text-sm text-gray-500">No products loaded yet.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {data.items.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
