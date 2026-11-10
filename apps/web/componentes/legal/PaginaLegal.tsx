import Link from 'next/link';
import type { ReactNode } from 'react';
import { VERSION_TERMINOS } from '@/lib/legal';

/** Quién opera la plataforma: se configura en el servicio web (ver docs/publicar.md). */
export const TITULAR = process.env.LEGAL_TITULAR?.trim() || 'Canchería';
export const CONTACTO = process.env.LEGAL_CONTACTO?.trim() || '';

export function contacto() {
  return CONTACTO ? (
    <a href={`mailto:${CONTACTO}`} className="font-semibold underline">
      {CONTACTO}
    </a>
  ) : (
    'los datos de contacto del club o de quien administra la plataforma'
  );
}

export function fechaVersion() {
  const [a, m, d] = VERSION_TERMINOS.split('-');
  return `${d}/${m}/${a}`;
}

export function PaginaLegal({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="tema-noche min-h-screen bg-fondo text-tinta">
      <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-10 text-base leading-relaxed sm:px-6 [&_h2]:mt-4 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:uppercase [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
        <Link href="/" className="text-sm font-semibold text-acento-texto underline">
          Canchería
        </Link>
        <h1 className="font-display text-[44px] leading-none font-extrabold uppercase">{titulo}</h1>
        <p className="text-sm text-tenue">Última actualización: {fechaVersion()}</p>
        {children}
      </main>
    </div>
  );
}
