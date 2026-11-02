import type { Metadata } from 'next';
import { Plataforma } from '@/componentes/panel/Plataforma';

export const metadata: Metadata = { title: 'Plataforma' };

export default function Pagina() {
  return <Plataforma />;
}
