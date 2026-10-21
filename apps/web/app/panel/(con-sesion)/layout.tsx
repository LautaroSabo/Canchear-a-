import type { Metadata } from 'next';
import { GuardSesion } from '@/componentes/panel/sesion';

export const metadata: Metadata = { title: 'Panel', robots: { index: false, follow: false } };

export default function LayoutPanel({ children }: { children: React.ReactNode }) {
  return <GuardSesion>{children}</GuardSesion>;
}
