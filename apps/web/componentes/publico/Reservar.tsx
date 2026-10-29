'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { API_URL, ErrorApi, pedir } from '@/lib/api';
import {
  fechaCorta,
  fechaLarga,
  hora,
  hoyEn,
  linkWhatsApp,
  nombreMes,
  pesos,
  proximosDias,
} from '@/lib/formato';
import { useEventosTurnos } from '@/lib/hooks';
import type { Alternativa, ClubPublico, Disponibilidad, ReservaPublica, Slot } from '@/lib/tipos';
import { uuid } from '@/lib/uuid';
import { IconoCerrar } from '../iconos';
import { Aviso, Boton, Campo, Cargando, Numero, Segmentado } from '../ui';
import { ListaEspera } from './ListaEspera';

const DIAS_VISIBLES = 14;
const nombreTipo = (n: number) => `Fútbol ${n}`;

interface Seleccion {
  canchaId: string;
  inicio: string;
}

type Errores = { nombre?: string; telefono?: string };

function validar(datos: { nombre: string; telefono: string }): Errores {
  const e: Errores = {};
  if (datos.nombre.trim().length < 2) e.nombre = 'Escribí tu nombre y apellido.';
  if (datos.telefono.replace(/\D/g, '').length < 8)
    e.telefono = 'Revisá el número: va con código de área, por ejemplo 11 5555-1234.';
  return e;
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
  const [errores, setErrores] = useState<Errores>({});
  const [aviso, setAviso] = useState<string | null>(null);
  // En el celular el formulario se abre como hoja desde la barra de abajo.
  const [hoja, setHoja] = useState(false);
  const idempotencia = useRef(uuid());
  const idTituloForm = useId();
  const refAside = useRef<HTMLElement>(null);
  const refContinuar = useRef<HTMLButtonElement>(null);

  const dias = useMemo(() => proximosDias(hoy, DIAS_VISIBLES), [hoy]);

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
  const sinHorarios = canchas.every((c) => c.slots.length === 0);
  const completo = !sinHorarios && canchas.every((c) => c.slots.every((s) => s.estado !== 'LIBRE'));
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
      setHoja(false);
      setAviso('Ese horario se acaba de ocupar. Elegí otro.');
    }
  }, [sel, elegido, disponibilidad.data]);

  // Hoja abierta: Escape la cierra y el foco entra al formulario.
  useEffect(() => {
    if (!hoja) return;
    refAside.current?.querySelector<HTMLInputElement>('input')?.focus();
    const cerrar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHoja(false);
    };
    window.addEventListener('keydown', cerrar);
    return () => {
      window.removeEventListener('keydown', cerrar);
      // Al cerrar, el foco vuelve a "Continuar" (si sigue habiendo un horario elegido).
      requestAnimationFrame(() => refContinuar.current?.focus());
    };
  }, [hoja]);

  const elegir = (s: Seleccion) => {
    setSel(s);
    setAviso(null);
    reservar.reset();
    idempotencia.current = uuid();
  };

  const cambiarDia = (d: string) => {
    setFecha(d);
    setSel(null);
    setHoja(false);
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

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const nuevos = validar(datos);
    setErrores(nuevos);
    if (nuevos.nombre || nuevos.telefono) {
      refAside.current
        ?.querySelector<HTMLInputElement>(`input[name="${nuevos.nombre ? 'nombre' : 'telefono'}"]`)
        ?.focus();
      return;
    }
    if (!reservar.isPending) reservar.mutate();
  };

  const error = reservar.error instanceof ErrorApi ? reservar.error : null;
  const alternativas =
    (error?.codigo === 'TURNO_OCUPADO'
      ? (error.detalle as { alternativas?: Alternativa[] })?.alternativas
      : null) ?? [];

  const meses = [...new Set([nombreMes(dias[0]?.fecha ?? hoy), nombreMes(dias.at(-1)?.fecha ?? hoy)])];
  const indiceDia = dias.findIndex((d) => d.fecha === fecha);
  const siguiente = dias[indiceDia + 1];

  return (
    <main className="mx-auto max-w-6xl px-4 pt-6 pb-36 sm:px-6 md:pb-16">
      <div inert={hoja}>
        <Condiciones club={club} />
      </div>

      <div className="mt-6 grid items-start gap-8 md:mt-0 md:grid-cols-[minmax(0,1fr)_340px] lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-labelledby="titulo-grilla" inert={hoja} className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="titulo-grilla" className="font-display text-[32px] leading-none font-bold uppercase">
              Elegí día y horario
            </h2>
            {tipos.length > 1 ? (
              <Segmentado
                etiqueta="Tipo de cancha"
                opciones={tipos.map((t) => ({ valor: String(t), etiqueta: nombreTipo(t) }))}
                valor={String(tipo)}
                onCambio={(v) => {
                  setTipo(Number(v));
                  setSel(null);
                  setHoja(false);
                }}
              />
            ) : null}
          </div>

          <fieldset className="mt-5 min-w-0">
            <legend className="mb-2 text-sm text-tenue first-letter:uppercase">{meses.join(' y ')}</legend>
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
              {dias.map((d) => {
                const activo = d.fecha === fecha;
                return (
                  <button
                    key={d.fecha}
                    type="button"
                    aria-pressed={activo}
                    aria-label={fechaCorta(d.fecha)}
                    onClick={() => cambiarDia(d.fecha)}
                    className={`flex min-h-17 w-15 shrink-0 flex-col items-center justify-center rounded-xs border ${
                      activo
                        ? 'border-acento bg-acento text-acento-tinta'
                        : 'border-linea text-tinta hover:border-borde-control'
                    }`}
                  >
                    <span className={`text-sm ${activo ? '' : 'text-tenue'}`}>{d.nombre}</span>
                    <Numero className="block text-[28px]">{d.numero}</Numero>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <p className="mt-4 text-base font-semibold" aria-live="polite">
            {fechaLarga(fecha)}
          </p>

          {aviso ? (
            <div className="mt-3">
              <Aviso tipo="ambar">{aviso}</Aviso>
            </div>
          ) : null}

          <div className="mt-4">
            {disponibilidad.isPending ? (
              <Cargando texto="Buscando horarios…" />
            ) : disponibilidad.isError ? (
              <Aviso>{disponibilidad.error.message}</Aviso>
            ) : cerrado || sinHorarios || completo ? (
              <div className="flex flex-col items-start gap-3 border border-linea px-5 py-6">
                <p className="text-base font-semibold">
                  {cerrado
                    ? 'Ese día el club está cerrado.'
                    : sinHorarios
                      ? 'Ya no quedan horarios para hoy.'
                      : 'Este día está completo.'}
                </p>
                <p className="text-sm text-tenue">
                  {completo
                    ? 'Anotate en la lista de espera de abajo y te avisamos si se libera algo, o mirá otro día.'
                    : 'Mirá los próximos días.'}
                </p>
                {siguiente ? (
                  <Boton variante="secundario" onClick={() => cambiarDia(siguiente.fecha)}>
                    Ver el {fechaCorta(siguiente.fecha)}
                  </Boton>
                ) : null}
              </div>
            ) : (
              <>
                <GrillaPorCancha canchas={canchas} zona={zona} sel={sel} elegir={elegir} />
                <GrillaPorHora canchas={canchas} zona={zona} sel={sel} elegir={elegir} />
              </>
            )}
          </div>
        </section>

        {hoja ? (
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setHoja(false)}
            className="fixed inset-0 z-20 bg-black/70 md:hidden"
          />
        ) : null}

        <aside
          ref={refAside}
          id="tus-datos"
          {...(hoja
            ? { role: 'dialog', 'aria-modal': true, 'aria-labelledby': idTituloForm }
            : { 'aria-label': 'Tu reserva' })}
          className={`min-w-0 md:sticky md:top-6 md:block ${
            hoja
              ? 'fixed inset-x-0 bottom-0 z-30 max-h-[92dvh] overflow-y-auto border-t border-linea bg-superficie px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+20px)] md:static md:max-h-none md:overflow-visible md:p-0'
              : 'hidden'
          } md:border md:border-linea md:bg-superficie md:p-6`}
        >
          {!elegido ? (
            <div className="flex flex-col gap-3">
              <h2 className="font-display text-2xl font-bold uppercase">Tu reserva</h2>
              <ol className="flex flex-col gap-2 text-base text-tenue">
                <li>1. Tocá un horario libre en la grilla.</li>
                <li>2. Dejá tu nombre y tu WhatsApp. No hace falta crear cuenta.</li>
                <li>3. Si pide seña, la pagás en el momento. Después te llega el QR para entrar.</li>
              </ol>
            </div>
          ) : (
            <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id={idTituloForm} className="text-base font-semibold">
                    {elegido.cancha.nombre} · {nombreTipo(elegido.cancha.jugadoresPorLado)}
                  </h2>
                  <Numero className="mt-1 block text-[34px] uppercase">
                    {fechaCorta(fecha)} · {hora(elegido.slot.inicio, zona)}
                  </Numero>
                  <p className="mt-1 text-sm text-tenue">
                    Hasta las {hora(elegido.slot.fin, zona)} ({elegido.cancha.duracionMin} min)
                  </p>
                </div>
                {hoja ? (
                  <button
                    type="button"
                    onClick={() => setHoja(false)}
                    aria-label="Volver a los horarios"
                    className="flex size-11 shrink-0 items-center justify-center rounded-xs border border-linea md:hidden"
                  >
                    <IconoCerrar />
                  </button>
                ) : null}
              </div>
              <Resumen slot={elegido.slot} />
              <Campo
                etiqueta="Nombre y apellido"
                name="nombre"
                autoComplete="name"
                value={datos.nombre}
                error={errores.nombre}
                onChange={(e) => setDatos({ ...datos, nombre: e.target.value })}
                required
                minLength={2}
              />
              <Campo
                etiqueta="WhatsApp"
                name="telefono"
                type="tel"
                autoComplete="tel"
                placeholder="11 5555-1234"
                ayuda="Te mandamos la confirmación y el QR por acá."
                error={errores.telefono}
                value={datos.telefono}
                onChange={(e) => setDatos({ ...datos, telefono: e.target.value })}
                required
              />
              <Campo
                etiqueta={
                  <span>
                    DNI <span className="font-normal text-tenue">(opcional, para sumar puntos)</span>
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
                          className="w-full rounded-xs bg-cesped px-3 py-2 text-left text-cesped-tinta hover:brightness-110"
                        >
                          <Numero className="block text-2xl">{hora(a.inicio, zona)}</Numero>
                          <span className="text-sm font-semibold">
                            {a.cancha} · {pesos(a.precio)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <Boton type="submit" grande disabled={reservar.isPending}>
                {reservar.isPending
                  ? 'Reservando…'
                  : elegido.slot.requiereSena
                    ? 'Reservar y pagar la seña'
                    : 'Confirmar reserva'}
              </Boton>
              <p className="text-sm leading-snug text-tenue">
                {!elegido.slot.requiereSena
                  ? 'Este horario no pide seña: queda confirmado al instante.'
                  : elegido.slot.minutosParaPagar
                    ? `Te guardamos el turno ${elegido.slot.minutosParaPagar} minutos para que pagues la seña. Si no se paga, se libera.`
                    : 'Te guardamos el turno un rato para que pagues la seña. Si no se paga, se libera.'}
              </p>
            </form>
          )}
        </aside>
      </div>

      <div inert={hoja}>
        <ListaEspera slug={club.slug} fecha={fecha} tipo={tipo} destacada={completo} />
      </div>

      {elegido ? (
        <div
          className={`fixed inset-x-0 bottom-0 z-10 border-t border-linea bg-superficie px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+14px)] md:hidden ${
            hoja ? 'invisible' : ''
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-tenue">
                {elegido.cancha.nombre} · {fechaCorta(fecha)}
              </p>
              <Numero className="block text-[26px]">
                {hora(elegido.slot.inicio, zona)} · {pesos(elegido.slot.precio)}
              </Numero>
              {elegido.slot.requiereSena ? (
                <p className="text-sm text-tenue">Seña {pesos(elegido.slot.montoSena)}</p>
              ) : null}
            </div>
            <Boton ref={refContinuar} grande onClick={() => setHoja(true)}>
              Continuar
            </Boton>
          </div>
        </div>
      ) : null}
    </main>
  );
}

/** Lo que conviene saber antes de elegir: sin cuenta, cómo se paga, qué queda para el club. */
function Condiciones({ club }: { club: ClubPublico }) {
  const { mercadoPago, transferencia } = club.mediosPago;
  const medios = [mercadoPago ? 'Mercado Pago' : null, transferencia ? 'transferencia' : null].filter(
    Boolean,
  );
  const items = [
    'Reservás sin crear cuenta: solo nombre y WhatsApp.',
    medios.length
      ? `Si el horario pide seña, la pagás online con ${medios.join(' o ')}.`
      : 'Si el horario pide seña, el club te dice cómo pagarla.',
    'El resto lo pagás en el club. Al llegar mostrás el QR.',
  ];
  return (
    <ul className="grid gap-y-2 text-sm text-tenue md:hidden" aria-label="Cómo funciona">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

function Resumen({ slot }: { slot: Slot }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 border-y border-linea py-3 text-base">
      <dt className="text-tenue">Precio del turno</dt>
      <dd className="cifras text-right font-semibold">{pesos(slot.precio)}</dd>
      {slot.requiereSena ? (
        <>
          <dt className="font-semibold">Seña para reservar (pagás ahora)</dt>
          <dd className="cifras text-right font-bold">{pesos(slot.montoSena)}</dd>
        </>
      ) : (
        <>
          <dt className="text-tenue">Seña</dt>
          <dd className="text-right font-semibold">No hace falta</dd>
        </>
      )}
      <dt className="text-tenue">Pagás en el club</dt>
      <dd className="cifras text-right font-semibold">{pesos(slot.precio - slot.montoSena)}</dd>
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
  if (elegido) return 'bg-cesped text-cesped-tinta outline-2 outline-offset-2 outline-cesped';
  if (slot.estado !== 'LIBRE') return 'text-ocupado-tinta opacity-60 cursor-not-allowed';
  return 'bg-superficie border-t-4 border-cesped text-tinta hover:bg-superficie-2';
}

const textoSlot = (s: Slot) => (s.estado === 'LIBRE' ? pesos(s.precio) : 'Ocupado');

/** Compu: una columna por cancha. */
function GrillaPorCancha({ canchas, zona, sel, elegir }: PropsGrilla) {
  return (
    <div
      className="hidden gap-6 md:grid"
      style={{ gridTemplateColumns: `repeat(${canchas.length}, minmax(0, 1fr))` }}
    >
      {canchas.map((c) => (
        <div key={c.id} className="min-w-0">
          <h3 className="font-display text-2xl font-bold uppercase">{c.nombre}</h3>
          <p className="mb-3 text-sm text-tenue">
            {c.techada ? 'Techada · ' : ''}Turnos de {c.duracionMin} min
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-1.5">
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
                  className={`min-h-16 rounded-xs px-2 py-2 text-left transition-[filter] ${claseSlot(s, elegido)}`}
                >
                  <Numero className="block text-[26px]">{hora(s.inicio, zona)}</Numero>
                  <span className="cifras text-sm font-semibold">{textoSlot(s)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Celular: una fila por horario y una columna por cancha; los nombres van una sola vez arriba. */
function GrillaPorHora({ canchas, zona, sel, elegir }: PropsGrilla) {
  const horas = [...new Set(canchas.flatMap((c) => c.slots.map((s) => s.inicio)))].sort();
  const columnas = `56px repeat(${canchas.length}, minmax(0, 1fr))`;
  return (
    <div className="md:hidden">
      <div
        className="sticky top-0 z-[1] grid gap-1.5 border-b border-linea bg-fondo py-2 text-sm font-semibold"
        style={{ gridTemplateColumns: columnas }}
        aria-hidden="true"
      >
        <span />
        {canchas.map((c) => (
          <span key={c.id} className="truncate">
            {c.nombre}
          </span>
        ))}
      </div>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {horas.map((inicio) => (
          <li key={inicio} className="grid items-center gap-1.5" style={{ gridTemplateColumns: columnas }}>
            <Numero className="text-2xl">{hora(inicio, zona)}</Numero>
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
                  className={`cifras min-h-12 rounded-xs px-1 text-sm font-semibold ${claseSlot(s, elegido)}`}
                >
                  {textoSlot(s)}
                </button>
              );
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}
