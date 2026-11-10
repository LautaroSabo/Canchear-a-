import type { Metadata } from 'next';
import Link from 'next/link';
import { PieLegal } from '@/componentes/legal/PieLegal';
import { EncabezadoClub } from '@/componentes/publico/EncabezadoClub';
import { Reservar } from '@/componentes/publico/Reservar';
import { cargarClub, cargarTorneos } from '@/lib/servidor';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const club = await cargarClub((await params).slug);
  const descripcion = `Reservá tu cancha en ${club.nombre} en un minuto, sin crear cuenta.${club.direccion ? ` ${club.direccion}.` : ''}`;
  // Vista previa al compartir el link por WhatsApp / redes.
  return {
    title: `Reservá en ${club.nombre}`,
    description: descripcion,
    openGraph: { title: `Reservá en ${club.nombre}`, description: descripcion, type: 'website' },
  };
}

export default async function PaginaClub({ params }: Props) {
  const { slug } = await params;
  const [club, torneos] = await Promise.all([cargarClub(slug), cargarTorneos(slug)]);
  const vigentes = torneos.filter((t) => t.estado !== 'FINALIZADO');
  return (
    <div className="tema-noche min-h-screen bg-fondo text-tinta">
      <EncabezadoClub club={club} />
      {torneos.length ? (
        <div className="border-b border-linea">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <p className="text-sm">
              {vigentes.length
                ? `${vigentes.length === 1 ? 'Hay un torneo' : `Hay ${vigentes.length} torneos`} en el club: ${vigentes.map((t) => t.nombre).join(', ')}.`
                : 'Mirá las tablas de los torneos del club.'}
            </p>
            <Link
              href={`/${slug}/torneos`}
              className="inline-flex min-h-11 items-center rounded-xs border border-borde-control px-3 text-sm font-semibold hover:border-tinta"
            >
              Tablas y horarios
            </Link>
          </div>
        </div>
      ) : null}
      <Reservar club={club} />
      <PieLegal />
    </div>
  );
}
