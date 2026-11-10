import type { Metadata } from 'next';
import Link from 'next/link';
import { PieLegal } from '@/componentes/legal/PieLegal';
import { EncabezadoClub } from '@/componentes/publico/EncabezadoClub';
import { ESTADO_TORNEO } from '@/componentes/torneos/comunes';
import { EstadoVacio, Insignia } from '@/componentes/ui';
import { fechaLarga, nombreTipo } from '@/lib/formato';
import { cargarClub, cargarTorneos } from '@/lib/servidor';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const club = await cargarClub((await params).slug);
  return {
    title: `Torneos en ${club.nombre}`,
    description: `Tablas, fixture y horarios de los torneos de ${club.nombre}.`,
  };
}

export default async function PaginaTorneos({ params }: Props) {
  const { slug } = await params;
  const [club, torneos] = await Promise.all([cargarClub(slug), cargarTorneos(slug)]);
  return (
    <div className="tema-noche min-h-screen bg-fondo text-tinta">
      <EncabezadoClub club={club} compacto />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
        <h1 className="font-display text-[44px] leading-none font-extrabold uppercase">Torneos y ligas</h1>
        {torneos.length === 0 ? (
          <EstadoVacio titulo="Este club todavía no tiene torneos." />
        ) : (
          <ul className="flex flex-col border border-linea">
            {torneos.map((t) => (
              <li key={t.id} className="border-b border-linea last:border-b-0">
                <Link
                  href={`/${slug}/torneos/${t.slug}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 hover:bg-superficie-2"
                >
                  <span className="min-w-0">
                    <span className="block font-display text-2xl font-bold uppercase">{t.nombre}</span>
                    <span className="text-sm text-tenue">
                      {nombreTipo(t.deporte, t.jugadoresPorLado)} · {t.equipos}{' '}
                      {t.equipos === 1 ? 'equipo' : 'equipos'} · desde el{' '}
                      {fechaLarga(t.fechaInicio).toLowerCase()}
                    </span>
                  </span>
                  <Insignia tono={ESTADO_TORNEO[t.estado].tono}>{ESTADO_TORNEO[t.estado].texto}</Insignia>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link href={`/${slug}`} className="text-sm font-semibold text-acento-texto underline">
          Volver a reservar cancha
        </Link>
      </main>
      <PieLegal />
    </div>
  );
}
