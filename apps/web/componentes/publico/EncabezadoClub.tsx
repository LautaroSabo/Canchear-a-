import { iniciales, linkWhatsApp } from '@/lib/formato';
import type { ClubPublico } from '@/lib/tipos';
import { IconoWhatsApp } from '../iconos';

export function EncabezadoClub({ club }: { club: Pick<ClubPublico, 'nombre' | 'direccion' | 'telefono'> }) {
  return (
    <header className="bg-noche text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex size-11 items-center justify-center rounded-xl bg-cancha font-display text-2xl font-bold sm:size-13">
          {iniciales(club.nombre)}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[26px] font-bold leading-tight sm:text-[32px]">{club.nombre}</h1>
          {club.direccion ? <p className="text-[13px] text-[#c9d3cc] sm:text-sm">{club.direccion}</p> : null}
        </div>
        {club.telefono ? (
          <a
            href={linkWhatsApp(club.telefono)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#3a4a40] px-3 text-sm font-semibold text-white hover:bg-noche-2 sm:px-4"
          >
            <IconoWhatsApp tamano={18} />
            <span className="hidden sm:inline">Consultas por WhatsApp</span>
            <span className="sm:hidden">WhatsApp</span>
          </a>
        ) : null}
      </div>
    </header>
  );
}
