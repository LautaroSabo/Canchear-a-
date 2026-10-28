import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { Comprobante } from '@/componentes/publico/Comprobante';
import { Cargando } from '@/componentes/ui';

export const metadata: Metadata = { title: 'Tu reserva', robots: { index: false, follow: false } };

export default async function PaginaReserva({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  if (!/^[0-9a-f]{32}$/.test(codigo)) notFound();
  return (
    <div className="tema-noche min-h-screen bg-fondo text-tinta">
      <Suspense
        fallback={
          <main className="mx-auto max-w-xl px-4 py-10">
            <Cargando texto="Buscando tu reserva…" />
          </main>
        }
      >
        <Comprobante codigo={codigo} />
      </Suspense>
    </div>
  );
}
