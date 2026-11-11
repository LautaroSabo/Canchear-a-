import type { Metadata } from 'next';

// El panel se puede instalar como app en el celular del encargado (abre en el panel, a
// pantalla completa). Las páginas públicas no llevan este manifest: si un jugador agrega la
// página del club a su inicio, abre la página del club.
export const metadata: Metadata = {
  manifest: '/panel.webmanifest',
  appleWebApp: { capable: true, title: 'Canchería', statusBarStyle: 'black-translucent' },
};

export default function LayoutPanel({ children }: { children: React.ReactNode }) {
  return children;
}
