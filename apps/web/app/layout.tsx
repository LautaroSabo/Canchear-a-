import '@fontsource-variable/inter';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'Canchería', template: '%s · Canchería' },
  description: 'Reservá tu cancha online, sin crear cuenta.',
};

export const viewport: Viewport = { themeColor: '#0f1a14', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-fondo font-sans text-tinta antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
