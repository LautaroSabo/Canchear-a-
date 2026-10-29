// Las letras se importan desde JS (el bundler resuelve el paquete igual en Windows y Linux).
import '@fontsource-variable/big-shoulders-display';
import '@fontsource-variable/schibsted-grotesk';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'Canchería', template: '%s · Canchería' },
  description: 'Reservá tu cancha online, sin crear cuenta.',
};

export const viewport: Viewport = {
  themeColor: '#0c1611',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-fondo font-sans text-tinta antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
