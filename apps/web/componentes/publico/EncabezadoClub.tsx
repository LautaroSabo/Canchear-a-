import Link from 'next/link';
import { linkWhatsApp } from '@/lib/formato';
import type { ClubPublico } from '@/lib/tipos';
import { IconoWhatsApp } from '../iconos';
import { LineasCancha } from './LineasCancha';

type Club = Pick<ClubPublico, 'nombre' | 'direccion' | 'telefono'> & { slug?: string };

/**
 * Cabecera del lado público. En la página del club es grande (el nombre del club es el
 * título de la página); en el comprobante va compacta y el nombre lleva a la grilla.
 */
export function EncabezadoClub({ club, compacto = false }: { club: Club; compacto?: boolean }) {
  const whatsapp = club.telefono ? (
    <a
      href={linkWhatsApp(club.telefono)}
      className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xs border border-borde-control px-3 text-sm font-semibold hover:border-tinta"
    >
      <IconoWhatsApp tamano={18} />
      <span className="hidden sm:inline">Consultas por WhatsApp</span>
      <span className="sm:hidden">WhatsApp</span>
    </a>
  ) : null;

  if (compacto) {
    return (
      <header className="border-b border-linea">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          {club.slug ? (
            <Link
              href={`/${club.slug}`}
              className="min-w-0 truncate font-display text-2xl font-bold uppercase hover:text-acento-texto"
            >
              {club.nombre}
            </Link>
          ) : (
            <span className="min-w-0 truncate font-display text-2xl font-bold uppercase">{club.nombre}</span>
          )}
          {whatsapp}
        </div>
      </header>
    );
  }

  return (
    <header className="relative overflow-hidden border-b border-linea">
      <LineasCancha className="text-cal opacity-[0.09]" />
      <div className="relative mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-x-6 gap-y-4 px-4 pt-10 pb-8 sm:px-6 sm:pt-16 sm:pb-10">
        <div className="min-w-0">
          <h1 className="font-display text-[44px] leading-[0.95] font-extrabold uppercase sm:text-[72px]">
            {club.nombre}
          </h1>
          {club.direccion ? <p className="mt-3 text-base text-tenue">{club.direccion}</p> : null}
        </div>
        {whatsapp}
      </div>
    </header>
  );
}
