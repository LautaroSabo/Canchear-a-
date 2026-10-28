import type { Metadata } from 'next';
import { EncabezadoClub } from '@/componentes/publico/EncabezadoClub';
import { Reservar } from '@/componentes/publico/Reservar';
import { cargarClub } from '@/lib/servidor';

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
  const club = await cargarClub((await params).slug);
  return (
    <div className="tema-noche min-h-screen bg-fondo text-tinta">
      <EncabezadoClub club={club} />
      <Reservar club={club} />
    </div>
  );
}
