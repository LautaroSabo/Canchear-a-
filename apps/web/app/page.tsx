import { PieLegal } from '@/componentes/legal/PieLegal';
import { LineasCancha } from '@/componentes/publico/LineasCancha';
import { BotonLink } from '@/componentes/ui';

// Club de ejemplo para el botón de la portada: en desarrollo, el demo; publicado, el que se
// configure en NEXT_PUBLIC_CLUB_EJEMPLO (si no hay ninguno, el botón no aparece).
const CLUB_EJEMPLO =
  process.env.NEXT_PUBLIC_CLUB_EJEMPLO ??
  (process.env.NODE_ENV === 'development' ? 'la-canchita' : undefined);

// Muestra de grilla para la portada: es la pieza que el jugador va a usar, así que es la imagen.
const MUESTRA = [
  { hora: '19:00', c1: '$38.000', c2: null },
  { hora: '20:00', c1: null, c2: null },
  { hora: '21:00', c1: '$45.000', c2: '$45.000' },
  { hora: '22:00', c1: null, c2: '$45.000' },
  { hora: '23:00', c1: '$40.000', c2: '$40.000' },
];

const PARA_CLUBES = [
  ['Agenda en vivo', 'Todas las canchas del día en una pantalla, con quién debe plata y quién ya llegó.'],
  [
    'Seña sin perseguir a nadie',
    'Mercado Pago se confirma solo; las transferencias las aprobás con un toque.',
  ],
  ['Turnos fijos', 'El grupo de los martes queda cargado para todo el año.'],
  ['Cantina y caja', 'Lo que consumen se suma al turno y se cobra todo junto.'],
];

export default function Inicio() {
  return (
    <div className="tema-noche min-h-screen bg-fondo text-tinta">
      <header className="relative overflow-hidden border-b border-linea">
        <LineasCancha className="text-cal opacity-[0.04] md:opacity-[0.08]" />
        <div className="relative mx-auto max-w-6xl px-4 pt-5 sm:px-6">
          <span className="font-display text-2xl font-bold uppercase">Canchería</span>
        </div>
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pt-10 pb-14 sm:px-6 md:grid-cols-[1.1fr_1fr] md:pt-16 md:pb-20">
          <div>
            <h1 className="font-display text-[56px] leading-[0.9] font-extrabold uppercase sm:text-[84px]">
              Reservá cancha sin llamar a nadie
            </h1>
            <p className="mt-5 max-w-md text-lg text-tenue">
              Fútbol, pádel o tenis: cada club tiene su link. Elegís el horario libre, dejás tus datos y te
              queda el QR para entrar. Sin crear cuenta.
            </p>
          </div>
          <MuestraGrilla />
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-12 px-4 py-14 sm:px-6 md:grid-cols-[1fr_1.3fr]">
        <section aria-labelledby="jugadores" className="flex flex-col items-start gap-4">
          <h2 id="jugadores" className="font-display text-[40px] leading-none font-bold uppercase">
            Si vas a jugar
          </h2>
          <p className="text-base text-tenue">
            Pedile el link de reservas a tu club (suele estar en su Instagram o en el estado de WhatsApp).
            {CLUB_EJEMPLO ? ' Si querés ver cómo funciona antes, probá con el club de ejemplo.' : ''}
          </p>
          {CLUB_EJEMPLO ? (
            <BotonLink href={`/${CLUB_EJEMPLO}`} grande>
              Ver el club de ejemplo
            </BotonLink>
          ) : null}
        </section>

        <section aria-labelledby="clubes" className="flex flex-col items-start gap-4">
          <h2 id="clubes" className="font-display text-[40px] leading-none font-bold uppercase">
            Si tenés un club
          </h2>
          <ul className="flex flex-col gap-3">
            {PARA_CLUBES.map(([titulo, texto]) => (
              <li key={titulo}>
                <p className="text-base font-semibold">{titulo}</p>
                <p className="text-sm text-tenue">{texto}</p>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <BotonLink href="/clubes" grande>
              Ver todo lo que hace
            </BotonLink>
            <BotonLink href="/panel" variante="secundario" grande>
              Entrar al panel
            </BotonLink>
          </div>
        </section>
      </main>
      <PieLegal />
    </div>
  );
}

function MuestraGrilla() {
  return (
    <figure
      aria-label="Así se ve la grilla de un club"
      className="w-full max-w-md justify-self-center md:justify-self-end"
    >
      <div className="border border-linea bg-superficie p-4 sm:p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="font-display text-2xl font-bold uppercase">Sábado 31</span>
          <span className="text-sm text-tenue">Fútbol 5</span>
        </div>
        <div aria-hidden="true" className="grid grid-cols-[56px_1fr_1fr] gap-1.5 text-sm font-semibold">
          <span />
          <span className="pb-1">Cancha 1</span>
          <span className="pb-1">Cancha 2</span>
          {MUESTRA.map((f) => (
            <Fila key={f.hora} {...f} />
          ))}
        </div>
      </div>
      <figcaption className="mt-3 text-sm text-tenue">
        Lo libre lleva la raya verde y el precio a la vista.
      </figcaption>
    </figure>
  );
}

function Fila({ hora, c1, c2 }: { hora: string; c1: string | null; c2: string | null }) {
  const celda = (precio: string | null, elegido = false) =>
    precio ? (
      <span
        className={`flex min-h-11 items-center justify-center rounded-xs font-semibold ${
          elegido ? 'bg-cesped text-cesped-tinta' : 'border-t-4 border-cesped bg-superficie-2'
        }`}
      >
        {precio}
      </span>
    ) : (
      <span className="flex min-h-11 items-center justify-center rounded-xs text-ocupado-tinta opacity-60">
        Ocupado
      </span>
    );
  return (
    <>
      <span className="cifras flex items-center font-display text-2xl font-bold">{hora}</span>
      {celda(c1, hora === '21:00')}
      {celda(c2)}
    </>
  );
}
