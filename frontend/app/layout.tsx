import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Mono } from 'next/font/google';
import { Header } from '@components/Header';
import './globals.css';
import { Providers } from './providers';

const archivo = Archivo({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-archivo' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex-mono' });

export const metadata: Metadata = {
  title: 'Veloce',
  description: 'Veloce — running, trail and court shoes. Pay in full or split into 3 installments with Veloce Pay.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`}>
      <body className="min-h-screen bg-white font-sans text-ink antialiased">
        <Providers>
          <div className="flex min-h-screen flex-col">
            <Header />
            <main className="flex min-h-0 flex-1 flex-col">{children}</main>
            <footer className="mt-auto border-t border-hair">
              <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-5 px-5 py-8">
                <span className="text-lg font-extrabold italic tracking-tight">VELOCE</span>
                <span className="font-mono text-[11px] leading-relaxed text-muted">
                  Veloce · demo on the BNPL system api-gateway
                </span>
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
