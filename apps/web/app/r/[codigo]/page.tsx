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
    <Suspense fallback={<Cargando texto="Buscando tu reserva…" />}>
      <Comprobante codigo={codigo} />
    </Suspense>
  );
}
