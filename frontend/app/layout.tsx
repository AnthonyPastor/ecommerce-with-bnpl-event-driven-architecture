import type { Metadata } from 'next';
import { Header } from '../components/Header';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'BNPL Store',
  description: 'Ecommerce con Buy Now, Pay Later',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <Providers>
          <Header />
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
