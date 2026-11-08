import type { Metadata } from 'next';
import { EncabezadoClub } from '@/componentes/publico/EncabezadoClub';
import { TorneoPublico } from '@/componentes/torneos/TorneoPublico';
import { cargarClub, cargarTorneo } from '@/lib/servidor';

type Props = { params: Promise<{ slug: string; torneo: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, torneo } = await params;
  const [club, v] = await Promise.all([cargarClub(slug), cargarTorneo(slug, torneo)]);
  const descripcion = `Tabla, fixture y horarios de ${v.torneo.nombre} en ${club.nombre}.`;
  return {
    title: `${v.torneo.nombre} · ${club.nombre}`,
    description: descripcion,
    openGraph: { title: v.torneo.nombre, description: descripcion, type: 'website' },
  };
}

export default async function PaginaTorneo({ params }: Props) {
  const { slug, torneo } = await params;
  const [club, vista] = await Promise.all([cargarClub(slug), cargarTorneo(slug, torneo)]);
  return (
    <div className="tema-noche min-h-screen bg-fondo text-tinta">
      <EncabezadoClub club={club} compacto />
      <TorneoPublico club={{ slug, zona: club.zonaHoraria }} inicial={vista} />
    </div>
  );
}
