'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // Revisiting a page (catalog, a product, the cart) shouldn't always
          // re-hit the backend — a minute-old response is fine for read paths
          // here. Queries that genuinely need fresher data (payment/order
          // polling) override this with their own `refetchInterval`.
          queries: { staleTime: 60 * 1000 },
        },
      }),
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
