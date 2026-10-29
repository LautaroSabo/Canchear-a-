'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { API_URL, panel } from '@/lib/api';
import { fechaLarga, fechaLocal, hora, hoyEn, pesos, sumarDias } from '@/lib/formato';
import { useAhora, useEventosTurnos } from '@/lib/hooks';
import type { Agenda as TipoAgenda, TurnoAgenda } from '@/lib/tipos';
import { IconoCerrar, IconoDerecha, IconoEscanear, IconoIzquierda } from '../iconos';
import { Aviso, Boton, BotonLink, Cargando, Segmentado } from '../ui';
import { DetalleTurno } from './DetalleTurno';
import { DialogoNuevo, type Prefill } from './DialogosTurno';
import { apariencia, CLASES, TEXTOS } from './estados';
import { useClubActual } from './sesion';

const PX_HORA = 56;
const HORA = 3_600_000;

type Filtro = 'todos' | 'deben' | 'pendientes' | 'revision';

const reales = (a: TipoAgenda) => a.turnos.filter((t) => t.origen !== 'BLOQUEO' && !anulado(t));
const anulado = (t: TurnoAgenda) => t.estado === 'CANCELADO' || t.estado === 'EXPIRADO';
const debe = (t: TurnoAgenda) => (t.estado === 'CONFIRMADO' || t.estado === 'PRESENTE') && t.saldo > 0;

const CUMPLE: Record<Filtro, (t: TurnoAgenda) => boolean> = {
  todos: () => true,
  deben: debe,
  pendientes: (t) => t.estado === 'PRE_RESERVADO' && !t.senaEnRevision,
  revision: (t) => t.estado === 'PRE_RESERVADO' && t.senaEnRevision,
};

function useEsAncho(consulta: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(consulta);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(consulta).matches,
    () => true,
  );
}

function relativo(fecha: string, hoy: string) {
  if (fecha === hoy) return 'Hoy';
  if (fecha === sumarDias(hoy, 1)) return 'Mañana';
  if (fecha === sumarDias(hoy, -1)) return 'Ayer';
  return null;
}

export function Agenda() {
  const { clubId, zona } = useClubActual();
  const router = useRouter();
  const ruta = usePathname();
  const qc = useQueryClient();
  const hoy = hoyEn(zona);
  const fecha = useSearchParams().get('fecha') ?? hoy;
  const [sel, setSel] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState<Prefill | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const ancho = useEsAncho('(min-width: 1024px)');

  const agenda = useQuery({
    queryKey: ['agenda', clubId, fecha],
    queryFn: () => panel.get<TipoAgenda>(`/clubs/${clubId}/agenda?fecha=${fecha}`),
  });
  useEventosTurnos(
    `${API_URL}/admin/clubs/${clubId}/eventos`,
    () => {
      qc.invalidateQueries({ queryKey: ['agenda', clubId] });
      qc.invalidateQueries({ queryKey: ['turno', clubId] });
      qc.invalidateQueries({ queryKey: ['transferencias', clubId] });
    },
    { conCredenciales: true },
  );

  const irA = (f: string) => {
    setSel(null);
    if (f) router.replace(`${ruta}?fecha=${f}`);
  };
  const rel = relativo(fecha, hoy);
  const hojaAbierta = Boolean(sel) && !ancho;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="font-display text-[40px] leading-none font-bold">
            {rel ? `${rel} · ` : ''}
            {fechaLarga(fecha)}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Boton
              variante="secundario"
              className="w-11 px-0"
              aria-label="Día anterior"
              onClick={() => irA(sumarDias(fecha, -1))}
            >
              <IconoIzquierda tamano={18} />
            </Boton>
            <label className="sr-only" htmlFor="ir-a-fecha">
              Ir a una fecha
            </label>
            <input
              id="ir-a-fecha"
              type="date"
              value={fecha}
              onChange={(e) => irA(e.target.value)}
              className="min-h-11 rounded-xs border border-borde-control bg-superficie px-3 text-base"
            />
            <Boton
              variante="secundario"
              className="w-11 px-0"
              aria-label="Día siguiente"
              onClick={() => irA(sumarDias(fecha, 1))}
            >
              <IconoDerecha tamano={18} />
            </Boton>
            {fecha !== hoy ? (
              <Boton variante="fantasma" onClick={() => irA(hoy)}>
                Volver a hoy
              </Boton>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <BotonLink variante="secundario" href={`/panel/${clubId}/checkin`}>
            <IconoEscanear tamano={18} /> Escanear QR
          </BotonLink>
          <Boton onClick={() => setNuevo({ canchaId: agenda.data?.canchas[0]?.id ?? '', hora: '20:00' })}>
            + Nuevo turno
          </Boton>
        </div>
      </header>

      {aviso ? (
        <div className="flex items-center gap-3 bg-noche px-4 py-3 text-base text-cal" role="status">
          <span className="flex-1">{aviso}</span>
          <button
            type="button"
            onClick={() => setAviso(null)}
            className="min-h-11 rounded-xs border border-[#3a5244] px-3 text-sm font-semibold"
          >
            Cerrar
          </button>
        </div>
      ) : null}

      {agenda.isPending ? (
        <Cargando texto="Cargando la agenda…" />
      ) : agenda.isError ? (
        <Aviso>{agenda.error.message}</Aviso>
      ) : (
        <>
          <Resumen agenda={agenda.data} filtro={filtro} setFiltro={setFiltro} />
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <Linea
              agenda={agenda.data}
              esHoy={fecha === hoy}
              sel={sel}
              setSel={setSel}
              filtro={filtro}
              nuevo={(p) => setNuevo(p)}
            />

            {hojaAbierta ? (
              <button
                type="button"
                tabIndex={-1}
                aria-label="Cerrar detalle"
                onClick={() => setSel(null)}
                className="fixed inset-0 z-30 bg-black/50 lg:hidden"
              />
            ) : null}
            <aside
              aria-label="Detalle del turno"
              className={
                hojaAbierta
                  ? 'fixed inset-x-0 bottom-0 z-40 max-h-[88dvh] overflow-y-auto border-t border-linea bg-superficie px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+20px)]'
                  : 'hidden min-w-0 border border-linea bg-superficie p-5 lg:sticky lg:top-8 lg:block'
              }
            >
              {sel ? (
                <>
                  {hojaAbierta ? (
                    <div className="mb-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setSel(null)}
                        aria-label="Cerrar detalle"
                        className="flex size-11 items-center justify-center rounded-xs border border-linea"
                      >
                        <IconoCerrar />
                      </button>
                    </div>
                  ) : null}
                  <DetalleTurno
                    turnoId={sel}
                    zona={agenda.data.zonaHoraria}
                    alHacer={(mensaje, { cerrar } = {}) => {
                      setAviso(mensaje);
                      if (cerrar) setSel(null);
                    }}
                  />
                </>
              ) : (
                <>
                  <h2 className="text-lg font-semibold">Detalle del turno</h2>
                  <p className="mt-1 text-base text-tenue">
                    Tocá un turno para ver el cliente, lo que debe y las acciones. Tocá un hueco libre para
                    cargar un turno ahí.
                  </p>
                </>
              )}
            </aside>
          </div>
        </>
      )}

      {agenda.data ? (
        <DialogoNuevo
          prefill={nuevo}
          agenda={agenda.data}
          alCerrar={() => setNuevo(null)}
          alCrear={(m) => {
            setNuevo(null);
            setAviso(m);
            qc.invalidateQueries({ queryKey: ['agenda', clubId] });
          }}
        />
      ) : null}
    </div>
  );
}

/** Las cifras del día son también los filtros: tocar "Deben plata" deja solo esos turnos a la vista. */
function Resumen({
  agenda,
  filtro,
  setFiltro,
}: {
  agenda: TipoAgenda;
  filtro: Filtro;
  setFiltro: (f: Filtro) => void;
}) {
  const turnos = reales(agenda);
  const minutos = (t: { inicio: string; fin: string }) => (Date.parse(t.fin) - Date.parse(t.inicio)) / 60_000;
  const abierto = agenda.apertura.reduce((s, v) => s + minutos(v), 0) * agenda.canchas.length;
  const bloqueado = agenda.turnos.filter((t) => t.origen === 'BLOQUEO').reduce((s, t) => s + minutos(t), 0);
  const ocupado = turnos.reduce((s, t) => s + minutos(t), 0);
  const ocupacion = abierto - bloqueado > 0 ? Math.round((ocupado / (abierto - bloqueado)) * 100) : 0;
  const aCobrar = turnos.filter(debe).reduce((s, t) => s + t.saldo, 0);
  const cuenta = (f: Filtro) => turnos.filter(CUMPLE[f]).length;

  const opciones: { valor: Filtro; etiqueta: string; n: number }[] = [
    { valor: 'todos', etiqueta: 'Todos', n: turnos.length },
    { valor: 'deben', etiqueta: 'Deben plata', n: cuenta('deben') },
    { valor: 'pendientes', etiqueta: 'Seña pendiente', n: cuenta('pendientes') },
    { valor: 'revision', etiqueta: 'A revisar', n: cuenta('revision') },
  ];
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <fieldset className="flex flex-wrap gap-1.5">
        <legend className="sr-only">Mostrar</legend>
        {opciones.map((o) => {
          const activo = filtro === o.valor;
          return (
            <button
              key={o.valor}
              type="button"
              aria-pressed={activo}
              onClick={() => setFiltro(activo && o.valor !== 'todos' ? 'todos' : o.valor)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-xs border px-3 text-sm font-semibold ${
                activo
                  ? 'border-tinta bg-tinta text-fondo'
                  : 'border-borde-control bg-superficie hover:border-tinta'
              }`}
            >
              {o.etiqueta}
              <span className="text-base font-bold">{o.n}</span>
            </button>
          );
        })}
      </fieldset>
      <p className="text-base text-tenue">
        Ocupación del día <strong className="text-tinta">{ocupacion}%</strong> · A cobrar en el club{' '}
        <strong className="text-tinta">{pesos(aCobrar)}</strong>
      </p>
    </div>
  );
}

function Linea({
  agenda,
  esHoy,
  sel,
  setSel,
  filtro,
  nuevo,
}: {
  agenda: TipoAgenda;
  esHoy: boolean;
  sel: string | null;
  setSel: (id: string) => void;
  filtro: Filtro;
  nuevo: (p: Prefill) => void;
}) {
  const ahora = useAhora(30_000);
  const zona = agenda.zonaHoraria;
  const ancho = useEsAncho('(min-width: 768px)');
  const [canchaMovil, setCanchaMovil] = useState(agenda.canchas[0]?.id ?? '');
  const contenedor = useRef<HTMLDivElement>(null);

  // Rango visible: el horario de apertura, ampliado si hay turnos manuales fuera de él.
  const inicios = [
    ...agenda.apertura.map((v) => Date.parse(v.inicio)),
    ...agenda.turnos.map((t) => Date.parse(t.inicio)),
  ];
  const fines = [
    ...agenda.apertura.map((v) => Date.parse(v.fin)),
    ...agenda.turnos.map((t) => Date.parse(t.fin)),
  ];
  const base = Date.parse(`${agenda.fecha}T00:00:00Z`);
  const desde = inicios.length ? Math.floor(Math.min(...inicios) / HORA) * HORA : base + 11 * HORA;
  const hasta = fines.length ? Math.ceil(Math.max(...fines) / HORA) * HORA : desde + 12 * HORA;
  const horas = Math.max(1, (hasta - desde) / HORA);
  const alto = horas * PX_HORA;
  const marcas = Array.from({ length: horas }, (_, i) => desde + i * HORA);
  const y = (ms: number) => ((ms - desde) / HORA) * PX_HORA;
  const ahoraVisible = esHoy && ahora >= desde && ahora <= hasta;

  const canchas = ancho ? agenda.canchas : agenda.canchas.filter((c) => c.id === canchaMovil);
  const activos = agenda.turnos.filter((t) => !anulado(t));
  const ocupada = (canchaId: string, ms: number) =>
    activos.some(
      (t) => t.canchaId === canchaId && Date.parse(t.inicio) < ms + HORA && Date.parse(t.fin) > ms,
    );

  // Hoy arranca en la hora actual; otro día, en el primer turno (no en horas vacías de la mañana).
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al cambiar de día.
  useEffect(() => {
    const c = contenedor.current;
    if (!c) return;
    const primero = Math.min(...activos.map((t) => Date.parse(t.inicio)));
    const destino = ahoraVisible ? y(ahora) : Number.isFinite(primero) ? y(primero) : 0;
    c.scrollTop = Math.max(0, destino - PX_HORA * 1.5);
  }, [agenda.fecha]);

  return (
    <section aria-label="Agenda por cancha" className="min-w-0">
      {!ancho && agenda.canchas.length > 1 ? (
        <Segmentado
          etiqueta="Cancha"
          className="mb-3 w-full"
          opciones={agenda.canchas.map((c) => ({ valor: c.id, etiqueta: c.nombre }))}
          valor={canchaMovil}
          onCambio={setCanchaMovil}
        />
      ) : null}
      <div
        ref={contenedor}
        className="max-h-[calc(100dvh-280px)] min-h-[420px] overflow-auto border border-linea bg-superficie"
      >
        <div
          className="grid"
          style={{ gridTemplateColumns: `56px repeat(${canchas.length}, minmax(160px, 1fr))` }}
        >
          <div className="sticky top-0 z-20 border-b border-linea bg-superficie" />
          {canchas.map((c) => (
            <div
              key={c.id}
              className="sticky top-0 z-20 border-b border-l border-linea bg-superficie px-3 py-2.5"
            >
              <span className="text-base font-semibold">{c.nombre}</span>{' '}
              <span className="text-sm text-tenue">F{c.jugadoresPorLado}</span>
            </div>
          ))}
          <div className="relative" style={{ height: alto }}>
            {marcas.map((ms, i) => (
              <div
                key={ms}
                className="cifras absolute right-2 font-display text-lg leading-none font-bold text-tenue"
                style={{ top: i * PX_HORA + 6 }}
              >
                {hora(new Date(ms), zona)}
              </div>
            ))}
          </div>
          {canchas.map((c) => (
            <div key={c.id} className="relative border-l border-linea" style={{ height: alto }}>
              {/* Un hueco por hora libre: se llega con el teclado y carga el turno en esa hora. */}
              {marcas.map((ms, i) =>
                ocupada(c.id, ms) ? null : (
                  <button
                    key={ms}
                    type="button"
                    aria-label={`Cargar un turno en ${c.nombre} a las ${hora(new Date(ms), zona)}`}
                    onClick={() =>
                      nuevo({
                        canchaId: c.id,
                        hora: hora(new Date(ms), zona),
                        fecha: fechaLocal(new Date(ms), zona),
                      })
                    }
                    className="group absolute inset-x-0 border-t border-linea text-left hover:bg-acento-suave focus-visible:bg-acento-suave"
                    style={{ top: i * PX_HORA, height: PX_HORA }}
                  >
                    <span className="hidden px-3 text-sm font-semibold text-acento-texto group-hover:inline group-focus-visible:inline">
                      + Cargar turno
                    </span>
                  </button>
                ),
              )}
              {marcas.map((ms, i) =>
                ocupada(c.id, ms) ? (
                  <div
                    key={ms}
                    aria-hidden="true"
                    className="absolute inset-x-0 border-t border-linea"
                    style={{ top: i * PX_HORA }}
                  />
                ) : null,
              )}
              {agenda.turnos
                .filter((t) => t.canchaId === c.id)
                .map((t) => (
                  <Bloque
                    key={t.id}
                    t={t}
                    zona={zona}
                    top={y(Date.parse(t.inicio))}
                    alto={y(Date.parse(t.fin)) - y(Date.parse(t.inicio))}
                    elegido={sel === t.id}
                    atenuado={filtro !== 'todos' && !CUMPLE[filtro](t)}
                    onClick={() => setSel(t.id)}
                  />
                ))}
              {ahoraVisible ? (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-peligro"
                  style={{ top: y(ahora) }}
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Bloque({
  t,
  zona,
  top,
  alto,
  elegido,
  atenuado,
  onClick,
}: {
  t: TurnoAgenda;
  zona: string;
  top: number;
  alto: number;
  elegido: boolean;
  atenuado: boolean;
  onClick: () => void;
}) {
  const a = apariencia(t);
  // Dos ejes separados: el estado del turno (color y forma) y la plata (texto).
  const plata =
    a === 'bloqueo'
      ? (t.nota ?? 'Bloqueada')
      : a === 'pendiente'
        ? `Seña vence ${t.expiraEn ? hora(t.expiraEn, zona) : ''}`
        : a === 'revision'
          ? 'Revisar comprobante'
          : a === 'cancelado' || a === 'ausente'
            ? TEXTOS[a]
            : t.saldo > 0
              ? `Debe ${pesos(t.saldo)}`
              : 'Pagado';
  const origen = t.origen === 'FIJO' ? 'Fijo' : t.origen === 'WEB' ? 'Web' : null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={elegido}
      aria-label={`${t.cliente?.nombre ?? 'Bloqueo'}, ${hora(t.inicio, zona)}, ${TEXTOS[a]}`}
      className={`absolute inset-x-1 z-[5] overflow-hidden rounded-xs px-2.5 py-1.5 text-left transition-opacity ${CLASES[a]} ${
        elegido ? 'outline-3 outline-offset-1 outline-tinta' : ''
      } ${atenuado ? 'opacity-25' : ''}`}
      style={{ top: top + 2, height: Math.max(alto - 4, 24) }}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[15px] font-semibold">{t.cliente?.nombre ?? 'Bloqueada'}</span>
        {origen ? <span className="shrink-0 text-sm opacity-80">{origen}</span> : null}
      </span>
      <span className="block truncate text-sm">
        {hora(t.inicio, zona)}–{hora(t.fin, zona)} · {plata}
      </span>
    </button>
  );
}
