import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Restablecer } from '@/componentes/acceso/Restablecer';

export const metadata: Metadata = { title: 'Contraseña nueva', robots: { index: false, follow: false } };

export default function Pagina() {
  return (
    <Suspense>
      <Restablecer />
    </Suspense>
  );
}
