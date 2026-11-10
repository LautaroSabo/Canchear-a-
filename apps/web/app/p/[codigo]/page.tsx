import type { Metadata } from 'next';
import Link from 'next/link';
import { IconoCalendario, IconoMapa } from '@/componentes/iconos';
import { PieLegal } from '@/componentes/legal/PieLegal';
import { EncabezadoClub } from '@/componentes/publico/EncabezadoClub';
import { Aviso, Numero } from '@/componentes/ui';
import { fechaCorta, fechaLarga, fechaLocal, hora } from '@/lib/formato';
import { cargarPartido } from '@/lib/servidor';
import type { PartidoCompartido } from '@/lib/tipos';

type Props = { params: Promise<{ codigo: string }> };

const cuando = (p: PartidoCompartido) => {
  const z = p.club.zonaHoraria;
  return `${fechaCorta(fechaLocal(p.inicio, z))} ${hora(p.inicio, z)}`;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await cargarPartido((await params).codigo);
  const titulo = `Partido en ${p.club.nombre} · ${cuando(p)}`;
  const descripcion = `${p.cancha}${p.club.direccion ? ` · ${p.club.direccion}` : ''}`;
  // Vista previa al pasarlo por WhatsApp. Sin indexar: es un link privado del grupo.
  return {
    title: titulo,
    description: descripcion,
    robots: { index: false, follow: false },
    openGraph: { title: titulo, description: descripcion, type: 'website' },
  };
}

function calendario(p: PartidoCompartido) {
  const f = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const escapar = (t: string) => t.replace(/[;,]/g, (m) => `\\${m}`);
  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cancheria//Partido//ES',
    'BEGIN:VEVENT',
    `UID:${f(p.inicio)}-${escapar(p.cancha)}@cancheria`,
    `DTSTAMP:${f(new Date().toISOString())}`,
    `DTSTART:${f(p.inicio)}`,
    `DTEND:${f(p.fin)}`,
    `SUMMARY:${escapar(`Turno en ${p.club.nombre} · ${p.cancha}`)}`,
    p.club.direccion ? `LOCATION:${escapar(p.club.direccion)}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lineas.join('\r\n'))}`;
}

const BOTON =
  'inline-flex min-h-11 items-center gap-2 rounded-xs border border-borde-control px-4 text-sm font-semibold hover:border-tinta';

export default async function PaginaPartido({ params }: Props) {
  const p = await cargarPartido((await params).codigo);
  const z = p.club.zonaHoraria;
  const fecha = fechaLocal(p.inicio, z);
  return (
    <div className="tema-noche min-h-screen bg-fondo text-tinta">
      <EncabezadoClub club={{ ...p.club, telefono: null }} compacto />
      <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <p className="text-base text-tenue">
            {p.organizador ? `${p.organizador} reservó cancha` : 'Partido reservado'}
          </p>
          <h1 className="mt-2 font-display text-[44px] leading-[0.95] font-extrabold uppercase sm:text-[56px]">
            {fechaLarga(fecha)}
          </h1>
          <Numero className="mt-3 block text-[40px]">
            {hora(p.inicio, z)} a {hora(p.fin, z)}
          </Numero>
          <p className="mt-3 text-lg font-semibold">
            {p.cancha} · {p.club.nombre}
          </p>
          {p.club.direccion ? <p className="text-base text-tenue">{p.club.direccion}</p> : null}
        </div>

        {p.estado === 'CANCELADO' ? (
          <Aviso>Este partido ya no está: la reserva se canceló o venció.</Aviso>
        ) : p.estado === 'PENDIENTE' ? (
          <Aviso tipo="ambar">
            La reserva todavía espera la seña: se confirma cuando {p.organizador || 'quien reservó'} la pague.
          </Aviso>
        ) : (
          <Aviso tipo="ok">Reserva confirmada.</Aviso>
        )}

        {p.estado !== 'CANCELADO' ? (
          <div className="flex flex-wrap gap-2">
            <a href={calendario(p)} download={`partido-${fecha}.ics`} className={BOTON}>
              <IconoCalendario tamano={18} /> Agregar al calendario
            </a>
            {p.club.direccion ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.club.nombre}, ${p.club.direccion}`)}`}
                className={BOTON}
              >
                <IconoMapa tamano={18} /> Cómo llegar
              </a>
            ) : null}
          </div>
        ) : null}

        <p className="border-t border-linea pt-6 text-sm text-tenue">
          ¿Querés armar otro partido?{' '}
          <Link href={`/${p.club.slug}`} className="font-semibold text-acento-texto underline">
            Mirá los horarios libres de {p.club.nombre}
          </Link>
          .
        </p>
      </main>
      <PieLegal />
    </div>
  );
}
