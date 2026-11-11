import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { PieLegal } from '@/componentes/legal/PieLegal';
import { LineasCancha } from '@/componentes/publico/LineasCancha';
import { BotonLink } from '@/componentes/ui';
import { pesos } from '@/lib/formato';
import { cargarPlataforma } from '@/lib/servidor';

export const metadata: Metadata = {
  title: 'Canchería para clubes: reservas online, señas y caja',
  description:
    'El sistema para tu club de fútbol, pádel o tenis: la gente reserva sola las 24 horas, la seña se cobra sola y vos ves la agenda, la caja y la cantina en un solo lugar.',
  openGraph: {
    title: 'Canchería para clubes',
    description: 'Reservas online, señas por Mercado Pago, agenda en vivo, caja y torneos.',
    type: 'website',
  },
};

const CLUB_EJEMPLO =
  process.env.NEXT_PUBLIC_CLUB_EJEMPLO ??
  (process.env.NODE_ENV === 'development' ? 'la-canchita' : undefined);

const DOLORES = [
  [
    'Se terminó el WhatsApp a las 2 de la mañana',
    'Cada uno ve los horarios libres y reserva solo, a la hora que sea.',
  ],
  [
    'Los que no vienen pagan igual',
    'La seña se cobra al reservar: si no pagan en unos minutos, el horario se libera solo.',
  ],
  ['Sabés cuánta plata entró', 'Cada cobro queda registrado. Al cerrar la caja ves si falta o sobra algo.'],
];

const FUNCIONES = [
  [
    'Reservas online 24 h',
    'Una página con el nombre de tu club. Sin que nadie se baje una app ni cree una cuenta.',
  ],
  [
    'Seña por Mercado Pago',
    'Se confirma sola y va directo a tu cuenta. También transferencia, que aprobás con un toque.',
  ],
  ['Agenda en vivo', 'Todas las canchas del día en una pantalla: quién viene, quién pagó, quién debe.'],
  ['Check-in con QR', 'Cada reserva tiene su QR. Lo escaneás con el celular cuando llegan.'],
  ['Turnos fijos', 'El grupo de los martes queda cargado para todo el año, sin pisarse con nadie.'],
  ['Lista de espera', 'Si alguien cancela, el lugar se le ofrece solo al primero de la lista.'],
  ['Recordatorios', 'Un mail antes del partido con el QR. Menos ausencias, sin que tengas que avisar.'],
  ['Cantina y caja', 'Lo que consumen se suma al turno. Cierre de caja por turno, con lo contado.'],
  ['Torneos y ligas', 'Fixture con días y canchas, tabla, cuadro e inscripción online de los equipos.'],
  ['Puntos y premios', 'Los clientes suman puntos por jugar y los canjean en el club.'],
  ['Reportes', 'Ocupación, horarios que más se piden, cobros por medio de pago y clientes frecuentes.'],
  ['Fútbol, pádel y tenis', 'Cada cancha con su deporte, sus horarios y sus precios.'],
];

const PASOS = [
  ['Registrás tu club', 'En un minuto, con tu email. Entrás directo a tu panel.'],
  [
    'Cargás canchas y precios',
    'Horarios, tarifas por franja, seña y cómo cobrás. Lo cambiás cuando quieras.',
  ],
  [
    'Compartís tu link',
    'En Instagram, en el estado de WhatsApp y en el cartel con QR que imprimís desde el panel.',
  ],
];

export default async function PaginaClubes() {
  await connection(); // el precio se lee en cada visita (de la configuración de la API)
  const { planes, diasPrueba } = await cargarPlataforma();
  const contacto = process.env.LEGAL_CONTACTO?.trim();
  const prueba = diasPrueba > 0 ? `Probalo gratis ${diasPrueba} días` : 'Registrá tu club';

  const preguntas: [string, string][] = [
    [
      '¿Necesito Mercado Pago?',
      'No. Podés cobrar la seña por transferencia, cobrar todo en el club, o pedir seña solo en los horarios que más se piden. Con Mercado Pago la seña se confirma sola.',
    ],
    [
      '¿Canchería se queda con un porcentaje de las reservas?',
      'No. La plata de las señas va directo a tu cuenta de Mercado Pago o a tu alias. Mercado Pago cobra su comisión habitual; Canchería solo cobra el abono mensual.',
    ],
    [
      '¿Los jugadores tienen que bajarse una app?',
      'No. Entran al link desde el celular, eligen el horario y reservan con nombre y WhatsApp.',
    ],
    [
      '¿Lo puedo usar desde el celular?',
      'Sí. El panel anda en el celular, la tablet o la compu, y la agenda se actualiza sola.',
    ],
    [
      '¿Qué pasa con mis datos?',
      'Son tuyos. Se hace una copia de seguridad todos los días y cada club ve solo lo suyo.',
    ],
    [
      '¿Puedo dejar de usarlo?',
      'Cuando quieras: no hay permanencia mínima. Si no seguís, simplemente no pagás el mes siguiente.',
    ],
  ];

  return (
    <div className="tema-noche min-h-screen bg-fondo text-tinta">
      <header className="relative overflow-hidden border-b border-linea">
        <LineasCancha className="text-cal opacity-[0.05] md:opacity-[0.08]" />
        <div className="relative mx-auto flex max-w-6xl items-center justify-between px-4 pt-5 sm:px-6">
          <Link href="/" className="font-display text-2xl font-bold uppercase">
            Canchería
          </Link>
          <Link href="/panel" className="text-sm font-semibold underline">
            Entrar al panel
          </Link>
        </div>
        <div className="relative mx-auto max-w-6xl px-4 pt-12 pb-16 sm:px-6 md:pt-20 md:pb-24">
          <p className="font-display text-xl font-bold tracking-wide text-acento-texto uppercase">
            Para clubes
          </p>
          <h1 className="mt-3 max-w-4xl font-display text-[52px] leading-[0.9] font-extrabold uppercase sm:text-[88px]">
            Tu club reserva y cobra solo
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-tenue">
            Fútbol, pádel o tenis: la gente reserva las 24 horas desde el celular, la seña se cobra al momento
            y vos ves la agenda, la caja y la cantina en un solo lugar.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <BotonLink href="/registrar" grande>
              {prueba}
            </BotonLink>
            {CLUB_EJEMPLO ? (
              <BotonLink href={`/${CLUB_EJEMPLO}`} variante="secundario" grande>
                Ver un club de ejemplo
              </BotonLink>
            ) : null}
          </div>
          {diasPrueba > 0 ? <p className="mt-3 text-sm text-tenue">Sin tarjeta. Sin permanencia.</p> : null}
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-20 px-4 py-16 sm:px-6">
        <section aria-label="Lo que cambia" className="grid gap-8 md:grid-cols-3">
          {DOLORES.map(([t, d]) => (
            <div key={t} className="border-t-[3px] border-acento-texto pt-4">
              <h2 className="font-display text-[28px] leading-none font-bold uppercase">{t}</h2>
              <p className="mt-3 text-base text-tenue">{d}</p>
            </div>
          ))}
        </section>

        <section aria-labelledby="funciones" className="flex flex-col gap-6">
          <h2 id="funciones" className="font-display text-[44px] leading-none font-bold uppercase">
            Todo lo que hace
          </h2>
          <ul className="grid gap-px overflow-hidden border border-linea bg-linea sm:grid-cols-2 lg:grid-cols-3">
            {FUNCIONES.map(([t, d]) => (
              <li key={t} className="bg-fondo p-5">
                <p className="text-base font-bold">{t}</p>
                <p className="mt-1 text-sm text-tenue">{d}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="empezar" className="flex flex-col gap-6">
          <h2 id="empezar" className="font-display text-[44px] leading-none font-bold uppercase">
            Empezás hoy
          </h2>
          <ol className="grid gap-6 md:grid-cols-3">
            {PASOS.map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <span className="cifras font-display text-[56px] leading-none font-extrabold text-acento-texto">
                  {i + 1}
                </span>
                <span>
                  <span className="block text-base font-bold">{t}</span>
                  <span className="text-sm text-tenue">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="precio" className="grid gap-8 md:grid-cols-[1fr_1fr] md:items-center">
          <div>
            <h2 id="precio" className="font-display text-[44px] leading-none font-bold uppercase">
              Un precio, todo incluido
            </h2>
            <p className="mt-4 text-base text-tenue">
              Todas las funciones, todas tus canchas y todos tus usuarios. Sin comisión por reserva.
            </p>
          </div>
          <div className="border border-acento-texto bg-superficie p-6">
            {planes.length ? (
              <>
                <p className="text-sm text-tenue">Según cuántas canchas tenés</p>
                <table className="mt-3 w-full text-left">
                  <tbody className="cifras">
                    {planes.map((p, i) => {
                      const siguiente = planes[i + 1];
                      const hasta = siguiente ? siguiente.desdeCanchas - 1 : null;
                      const canchas =
                        hasta === null
                          ? `${p.desdeCanchas} o más canchas`
                          : p.desdeCanchas === hasta
                            ? `${hasta} ${hasta === 1 ? 'cancha' : 'canchas'}`
                            : `${p.desdeCanchas} a ${hasta} canchas`;
                      return (
                        <tr key={p.desdeCanchas} className="border-b border-linea last:border-b-0">
                          <th scope="row" className="py-3 pr-3 font-normal">
                            <span className="block font-bold">{p.nombre}</span>
                            <span className="text-sm text-tenue">{canchas}</span>
                          </th>
                          <td className="py-3 text-right">
                            <span className="font-display text-[36px] leading-none font-extrabold">
                              {pesos(p.precio)}
                            </span>
                            <span className="block text-sm text-tenue">por mes</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="text-lg font-semibold">Escribinos y te pasamos el precio para tu club.</p>
            )}
            <ul className="mt-5 flex flex-col gap-1.5 text-sm">
              {diasPrueba > 0 ? <li>✓ {diasPrueba} días gratis para probarlo con tus clientes</li> : null}
              <li>✓ Pagando el año, 2 meses gratis</li>
              <li>✓ Sin permanencia: lo dejás cuando quieras</li>
              <li>✓ La plata de las señas va directo a tu cuenta</li>
              <li>✓ Copia de seguridad diaria de tus datos</li>
            </ul>
            <BotonLink href="/registrar" grande className="mt-6 w-full">
              {prueba}
            </BotonLink>
          </div>
        </section>

        <section aria-labelledby="preguntas" className="flex flex-col gap-4">
          <h2 id="preguntas" className="font-display text-[44px] leading-none font-bold uppercase">
            Preguntas
          </h2>
          <div className="flex flex-col border-t border-linea">
            {preguntas.map(([p, r]) => (
              <details key={p} className="group border-b border-linea py-4">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold">
                  {p}
                  <span
                    aria-hidden="true"
                    className="text-acento-texto transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-2 max-w-3xl text-base text-tenue">{r}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="flex flex-col items-start gap-4 border-t border-linea pt-12">
          <h2 className="font-display text-[44px] leading-none font-bold uppercase">¿Lo probamos?</h2>
          <p className="max-w-xl text-base text-tenue">
            Registrás el club, cargás tus canchas y compartís el link. Si tenés dudas antes, escribinos
            {contacto ? (
              <>
                {' a '}
                <a href={`mailto:${contacto}`} className="font-semibold text-tinta underline">
                  {contacto}
                </a>
              </>
            ) : null}
            .
          </p>
          <BotonLink href="/registrar" grande>
            {prueba}
          </BotonLink>
        </section>
      </main>
      <PieLegal />
    </div>
  );
}
