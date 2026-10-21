'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { API_URL, ErrorApi, pedir } from '@/lib/api';
import { fechaCorta, hora, hoyEn, linkWhatsApp, pesos, proximosDias } from '@/lib/formato';
import { useEventosTurnos } from '@/lib/hooks';
import type { Alternativa, ClubPublico, Disponibilidad, ReservaPublica, Slot } from '@/lib/tipos';
import { uuid } from '@/lib/uuid';
import { Aviso, Boton, Campo, Cargando, Numero, Tarjeta } from '../ui';
import { ListaEspera } from './ListaEspera';

const DIAS_VISIBLES = 14;
const nombreTipo = (n: number) => `Fútbol ${n}`;

interface Seleccion {
  canchaId: string;
  inicio: string;
}

export function Reservar({ club }: { club: ClubPublico }) {
  const zona = club.zonaHoraria;
  const router = useRouter();
  const qc = useQueryClient();
  const [hoy] = useState(() => hoyEn(zona));
  const tipos = useMemo(
    () => [...new Set(club.canchas.map((c) => c.jugadoresPorLado))].sort((a, b) => a - b),
    [club.canchas],
  );
  const [tipo, setTipo] = useState(tipos[0] ?? 5);
  const [fecha, setFecha] = useState(hoy);
  const [sel, setSel] = useState<Seleccion | null>(null);
  const [datos, setDatos] = useState({ nombre: '', telefono: '', dni: '' });
  const [aviso, setAviso] = useState<string | null>(null);
  const idempotencia = useRef(uuid());

  const disponibilidad = useQuery({
    queryKey: ['disponibilidad', club.slug, fecha, tipo],
    queryFn: ({ signal }) =>
      pedir<Disponibilidad>(`/public/clubs/${club.slug}/disponibilidad?fecha=${fecha}&jugadores=${tipo}`, {
        signal,
      }),
  });
  useEventosTurnos(`${API_URL}/public/clubs/${club.slug}/eventos`, () =>
    qc.invalidateQueries({ queryKey: ['disponibilidad', club.slug] }),
  );

  // Los horarios que ya pasaron no se muestran (en "hoy" serían media pantalla de botones grises).
  const canchas = useMemo(
    () =>
      (disponibilidad.data?.canchas ?? []).map((c) => ({
        ...c,
        slots: c.slots.filter((s) => s.estado !== 'PASADO'),
      })),
    [disponibilidad.data],
  );
  const cerrado = (disponibilidad.data?.canchas ?? []).every((c) => c.slots.length === 0);
  const elegido = useMemo(() => {
    if (!sel) return null;
    const cancha = canchas.find((c) => c.id === sel.canchaId);
    const slot = cancha?.slots.find((s) => s.inicio === sel.inicio);
    return cancha && slot ? { cancha, slot } : null;
  }, [sel, canchas]);

  // Si mientras completaba los datos otra persona tomó el horario, avisar enseguida.
  useEffect(() => {
    if (sel && disponibilidad.data && elegido?.slot.estado !== 'LIBRE') {
      setSel(null);
      setAviso('Ese horario se acaba de ocupar. Elegí otro.');
    }
  }, [sel, elegido, disponibilidad.data]);

  const elegir = (s: Seleccion) => {
    setSel(s);
    setAviso(null);
    reservar.reset();
    idempotencia.current = uuid();
  };

  const reservar = useMutation({
    mutationFn: () => {
      if (!sel) throw new Error('Elegí un horario');
      return pedir<ReservaPublica>(`/public/clubs/${club.slug}/reservas`, {
        metodo: 'POST',
        json: {
          canchaId: sel.canchaId,
          inicio: sel.inicio,
          cliente: {
            nombre: datos.nombre.trim(),
            telefono: datos.telefono.trim(),
            ...(datos.dni.trim() ? { dni: datos.dni.trim() } : {}),
          },
          idempotencyKey: idempotencia.current,
        },
      });
    },
    onSuccess: (r) => router.push(`/r/${r.codigo}`),
    onError: (e) => {
      if (e instanceof ErrorApi && e.codigo === 'TURNO_OCUPADO') {
        qc.invalidateQueries({ queryKey: ['disponibilidad', club.slug] });
      }
    },
  });

  const datosOk = datos.nombre.trim().length >= 2 && datos.telefono.replace(/\D/g, '').length >= 8;
  const error = reservar.error instanceof ErrorApi ? reservar.error : null;
  const alternativas =
    (error?.codigo === 'TURNO_OCUPADO'
      ? (error.detalle as { alternativas?: Alternativa[] })?.alternativas
      : null) ?? [];

  return (
    <main className="mx-auto max-w-6xl px-4 pb-32 pt-5 sm:px-6 md:pb-10">
      <div className="flex flex-wrap items-start gap-6">
        <section
          aria-labelledby="titulo-grilla"
          className="min-w-0 flex-[999_1_560px] rounded-2xl border border-linea bg-white p-4 sm:p-5"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 id="titulo-grilla" className="text-lg font-bold">
              Elegí día y horario
            </h2>
            {tipos.length > 1 ? (
              <fieldset className="flex min-w-0 gap-1 rounded-xl bg-[#eef1ee] p-1">
                <legend className="sr-only">Tipo de cancha</legend>
                {tipos.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={t === tipo}
                    onClick={() => {
                      setTipo(t);
                      setSel(null);
                    }}
                    className={`min-h-10 rounded-lg px-4 text-sm font-semibold ${
                      t === tipo ? 'bg-white shadow-sm' : 'text-medio hover:text-tinta'
                    }`}
                  >
                    {nombreTipo(t)}
                  </button>
                ))}
              </fieldset>
            ) : null}
          </div>

          <fieldset className="-mx-1 mb-4 flex min-w-0 gap-2 overflow-x-auto px-1 pb-1">
            <legend className="sr-only">Día</legend>
            {proximosDias(hoy, DIAS_VISIBLES).map((d) => (
              <button
                key={d.fecha}
                type="button"
                aria-pressed={d.fecha === fecha}
                aria-label={fechaCorta(d.fecha)}
                onClick={() => {
                  setFecha(d.fecha);
                  setSel(null);
                }}
                className={`min-h-16 min-w-16 shrink-0 rounded-xl border-[1.5px] ${
                  d.fecha === fecha
                    ? 'border-noche bg-noche text-white'
                    : 'border-borde bg-white hover:border-medio'
                }`}
              >
                <span className="block text-xs font-semibold uppercase tracking-wide">{d.nombre}</span>
                <Numero className="block text-[26px]">{d.numero}</Numero>
              </button>
            ))}
          </fieldset>

          <div className="mb-4 flex flex-wrap gap-4 text-[13px] text-medio">
            <Leyenda clase="border-[1.5px] border-cancha bg-white">Libre</Leyenda>
            <Leyenda clase="bg-ocupado">Ocupado</Leyenda>
            <Leyenda clase="bg-cancha">Elegido</Leyenda>
          </div>

          {aviso ? (
            <div className="mb-4">
              <Aviso tipo="ambar">{aviso}</Aviso>
            </div>
          ) : null}

          {disponibilidad.isPending ? (
            <Cargando texto="Buscando horarios…" />
          ) : disponibilidad.isError ? (
            <Aviso>{disponibilidad.error.message}</Aviso>
          ) : cerrado ? (
            <p className="py-6 text-suave">Ese día el club está cerrado. Probá con otra fecha.</p>
          ) : canchas.every((c) => c.slots.length === 0) ? (
            <p className="py-6 text-suave">Ya no quedan horarios para hoy. Mirá los próximos días.</p>
          ) : (
            <>
              <GrillaPorCancha canchas={canchas} zona={zona} sel={sel} elegir={elegir} />
              <GrillaPorHora canchas={canchas} zona={zona} sel={sel} elegir={elegir} />
            </>
          )}
        </section>

        <aside id="tus-datos" aria-label="Tu reserva" className="min-w-0 flex-[1_1_340px] scroll-mt-4">
          <Tarjeta>
            {!elegido ? (
              <>
                <h2 className="mb-2 text-lg font-bold">Tu reserva</h2>
                <p className="leading-relaxed text-suave">
                  Tocá un horario libre. No hace falta crear una cuenta: solo tu nombre y tu WhatsApp.
                </p>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (datosOk && !reservar.isPending) reservar.mutate();
                }}
                className="flex flex-col gap-3"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-lg font-bold">{elegido.cancha.nombre}</h2>
                  <span className="text-[13px] text-suave">
                    {nombreTipo(elegido.cancha.jugadoresPorLado)}
                  </span>
                </div>
                <Numero className="text-[32px]">
                  {fechaCorta(fecha)} · {hora(elegido.slot.inicio, zona)} a {hora(elegido.slot.fin, zona)}
                </Numero>
                <Resumen slot={elegido.slot} />
                <div className="my-1 h-px bg-linea" />
                <Campo
                  etiqueta="Nombre y apellido"
                  autoComplete="name"
                  value={datos.nombre}
                  onChange={(e) => setDatos({ ...datos, nombre: e.target.value })}
                  required
                  minLength={2}
                />
                <Campo
                  etiqueta="WhatsApp"
                  type="tel"
                  autoComplete="tel"
                  placeholder="11 5555-1234"
                  ayuda="Te mandamos la confirmación y el QR por acá."
                  value={datos.telefono}
                  onChange={(e) => setDatos({ ...datos, telefono: e.target.value })}
                  required
                />
                <Campo
                  etiqueta={
                    <span>
                      DNI <span className="font-normal text-suave">(opcional, para sumar puntos)</span>
                    </span>
                  }
                  inputMode="numeric"
                  placeholder="30.123.456"
                  value={datos.dni}
                  onChange={(e) => setDatos({ ...datos, dni: e.target.value })}
                />

                {error ? (
                  <Aviso>
                    {error.message}
                    {error.codigo === 'RESERVA_MUY_CERCANA' && club.telefono ? (
                      <>
                        {' '}
                        <a className="font-semibold underline" href={linkWhatsApp(club.telefono)}>
                          Escribile al club
                        </a>
                      </>
                    ) : null}
                  </Aviso>
                ) : null}
                {alternativas.length > 0 ? (
                  <div>
                    <p className="mb-2 text-sm font-semibold">Estos siguen libres:</p>
                    <ul className="grid grid-cols-2 gap-2">
                      {alternativas.map((a) => (
                        <li key={`${a.canchaId}${a.inicio}`}>
                          <button
                            type="button"
                            onClick={() => elegir({ canchaId: a.canchaId, inicio: a.inicio })}
                            className="w-full rounded-xl border-[1.5px] border-cancha bg-white px-2 py-2 text-left hover:bg-cancha-claro"
                          >
                            <Numero className="block text-xl">{hora(a.inicio, zona)}</Numero>
                            <span className="text-xs">
                              {a.cancha} · {pesos(a.precio)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <Boton type="submit" grande disabled={!datosOk || reservar.isPending}>
                  {reservar.isPending
                    ? 'Reservando…'
                    : elegido.slot.requiereSena
                      ? 'Reservar y pagar la seña'
                      : 'Confirmar reserva'}
                </Boton>
                <p className="text-[13px] leading-snug text-suave">
                  {elegido.slot.requiereSena
                    ? 'Al reservar te guardamos el turno unos minutos para que pagues la seña.'
                    : 'Este horario no pide seña: queda confirmado al instante.'}
                </p>
              </form>
            )}
          </Tarjeta>
        </aside>
      </div>

      <ListaEspera slug={club.slug} fecha={fecha} tipo={tipo} />

      {elegido ? (
        <div className="fixed inset-x-0 bottom-0 z-10 flex items-center gap-3 border-t border-linea bg-white px-4 pb-5 pt-3 md:hidden">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-suave">
              {elegido.cancha.nombre} · {fechaCorta(fecha)}
            </div>
            <Numero className="block text-[22px]">
              {hora(elegido.slot.inicio, zona)} · {pesos(elegido.slot.precio)}
            </Numero>
          </div>
          <Boton
            grande
            onClick={() => document.getElementById('tus-datos')?.scrollIntoView({ behavior: 'smooth' })}
          >
            Continuar
          </Boton>
        </div>
      ) : null}
    </main>
  );
}

function Leyenda({ clase, children }: { clase: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-3.5 rounded ${clase}`} aria-hidden="true" />
      {children}
    </span>
  );
}

function Resumen({ slot }: { slot: Slot }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-[15px]">
      <dt className="text-suave">Precio del turno</dt>
      <dd className="font-semibold">{pesos(slot.precio)}</dd>
      <dt className="text-suave">{slot.requiereSena ? 'Seña para reservar' : 'Seña'}</dt>
      <dd className="font-semibold">{slot.requiereSena ? pesos(slot.montoSena) : 'No hace falta'}</dd>
      <dt className="text-suave">Pagás en el club</dt>
      <dd className="font-semibold">{pesos(slot.precio - slot.montoSena)}</dd>
    </dl>
  );
}

type PropsGrilla = {
  canchas: Disponibilidad['canchas'];
  zona: string;
  sel: Seleccion | null;
  elegir: (s: Seleccion) => void;
};

function claseSlot(slot: Slot, elegido: boolean) {
  if (elegido) return 'border-cancha bg-cancha text-white';
  if (slot.estado !== 'LIBRE') return 'border-ocupado bg-ocupado text-suave cursor-not-allowed';
  return 'border-cancha bg-white hover:bg-cancha-claro';
}

const textoSlot = (s: Slot) => (s.estado === 'LIBRE' ? pesos(s.precio) : 'Ocupado');

/** Compu: una columna por cancha. */
function GrillaPorCancha({ canchas, zona, sel, elegir }: PropsGrilla) {
  return (
    <div
      className="hidden gap-5 md:grid"
      style={{ gridTemplateColumns: `repeat(${canchas.length}, minmax(0, 1fr))` }}
    >
      {canchas.map((c) => (
        <div key={c.id} className="min-w-0">
          <h3 className="font-bold">{c.nombre}</h3>
          <p className="mb-2.5 text-[13px] text-suave">
            {c.techada ? 'Techada · ' : ''}Turnos de {c.duracionMin} min
          </p>
          <div className="grid grid-cols-3 gap-2">
            {c.slots.map((s) => {
              const elegido = sel?.canchaId === c.id && sel.inicio === s.inicio;
              return (
                <button
                  key={s.inicio}
                  type="button"
                  disabled={s.estado !== 'LIBRE'}
                  aria-pressed={elegido}
                  aria-label={`${c.nombre} ${hora(s.inicio, zona)}, ${textoSlot(s)}`}
                  onClick={() => elegir({ canchaId: c.id, inicio: s.inicio })}
                  className={`min-h-14 rounded-xl border-[1.5px] px-1 py-1.5 text-center ${claseSlot(s, elegido)}`}
                >
                  <Numero className="block text-[22px]">{hora(s.inicio, zona)}</Numero>
                  <span className="text-xs font-medium">{textoSlot(s)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Celular: una fila por horario con las canchas como botones (se tocan con el pulgar). */
function GrillaPorHora({ canchas, zona, sel, elegir }: PropsGrilla) {
  const horas = [...new Set(canchas.flatMap((c) => c.slots.map((s) => s.inicio)))].sort();
  return (
    <ul className="flex flex-col gap-2 md:hidden">
      {horas.map((inicio) => {
        const precio = canchas.flatMap((c) => c.slots).find((s) => s.inicio === inicio)?.precio ?? 0;
        return (
          <li
            key={inicio}
            className="flex items-center gap-3 rounded-xl border border-linea bg-white px-3 py-2.5"
          >
            <div className="w-16 shrink-0">
              <Numero className="block text-2xl">{hora(inicio, zona)}</Numero>
              <span className="text-xs text-suave">{pesos(precio)}</span>
            </div>
            <div
              className="grid flex-1 gap-2"
              style={{ gridTemplateColumns: `repeat(${canchas.length}, minmax(0, 1fr))` }}
            >
              {canchas.map((c) => {
                const s = c.slots.find((x) => x.inicio === inicio);
                if (!s) return <span key={c.id} aria-hidden="true" />;
                const elegido = sel?.canchaId === c.id && sel.inicio === inicio;
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={s.estado !== 'LIBRE'}
                    aria-pressed={elegido}
                    aria-label={`${c.nombre} ${hora(inicio, zona)}, ${textoSlot(s)}`}
                    onClick={() => elegir({ canchaId: c.id, inicio })}
                    className={`min-h-11 rounded-xl border-[1.5px] text-[13px] font-semibold ${claseSlot(s, elegido)}`}
                  >
                    {s.estado === 'LIBRE' ? c.nombre : 'Ocupada'}
                  </button>
                );
              })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
