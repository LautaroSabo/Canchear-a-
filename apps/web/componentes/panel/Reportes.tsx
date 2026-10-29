'use client';

import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { API_URL, ErrorApi, mensajeDe, panel } from '@/lib/api';
import { fechaCorta, hoyEn, pesos, sumarDias, telefonoLegible } from '@/lib/formato';
import type { ReporteClub } from '@/lib/tipos';
import { Aviso, Boton, Campo, Cargando, Tarjeta } from '../ui';
import { MEDIOS } from './cantina/comunes';
import { DIAS, ORDEN_SEMANA } from './config/comunes';
import { useClubActual } from './sesion';

/** Rampa secuencial de un solo tono (verde de la marca), validada: monótona y el paso más claro a 2.1:1 del fondo. */
const RAMPA = ['#8fcca3', '#5fb07d', '#348f57', '#1b7340', '#0f5a30'];
const SIN_OCUPAR = 'var(--superficie-2)';
const COLOR_BARRA = 'var(--acento)';

const ESTADOS: Record<string, string> = {
  PRESENTE: 'Jugados',
  AUSENTE: 'Ausentes',
  CONFIRMADO: 'Confirmados (por jugar)',
  CANCELADO: 'Cancelados',
  EXPIRADO: 'Vencidos sin seña',
  PRE_RESERVADO: 'Esperando seña',
};
const ORIGENES: Record<string, string> = { WEB: 'Reserva web', MANUAL: 'Carga manual', FIJO: 'Turno fijo' };
const CONCEPTOS: Record<string, string> = { SENA: 'Señas', SALDO: 'Saldos', CONSUMO: 'Consumos' };
const MEDIOS_PAGO: Record<string, string> = { ...MEDIOS, OTRO: 'Otro' };

const porcentaje = (x: number) => `${Math.round(x * 100)}%`;

/** $1.234.567 → "$1,2 M"; $350.000 → "$350 mil". Para ejes y etiquetas cortas. */
function pesosCortos(centavos: number) {
  const p = centavos / 100;
  if (p >= 1_000_000) return `$${(p / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`;
  if (p >= 1_000) return `$${Math.round(p / 1_000)} mil`;
  return `$${Math.round(p)}`;
}

/** Paso "redondo" para el eje: 1, 2 o 5 × 10ⁿ. */
function pasoRedondo(maximo: number, marcas = 4) {
  const crudo = maximo / marcas;
  const pot = 10 ** Math.floor(Math.log10(crudo || 1));
  const n = crudo / pot;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pot;
}

function useAncho<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [ancho, setAncho] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAncho(e?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, ancho] as const;
}

type Periodo = { desde: string; hasta: string };

function presets(hoy: string): { nombre: string; p: Periodo }[] {
  const [a, m] = hoy.split('-').map(Number) as [number, number];
  const inicioMes = `${hoy.slice(0, 8)}01`;
  const mesPasado = m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, '0')}-01`;
  const dow = (new Date(`${hoy}T12:00:00Z`).getUTCDay() + 6) % 7; // lunes = 0
  return [
    { nombre: 'Esta semana', p: { desde: sumarDias(hoy, -dow), hasta: hoy } },
    { nombre: 'Últimos 30 días', p: { desde: sumarDias(hoy, -29), hasta: hoy } },
    { nombre: 'Este mes', p: { desde: inicioMes, hasta: hoy } },
    { nombre: 'Mes pasado', p: { desde: mesPasado, hasta: sumarDias(inicioMes, -1) } },
  ];
}

export function Reportes() {
  const { clubId, zona } = useClubActual();
  const hoy = hoyEn(zona);
  const opciones = presets(hoy);
  const [periodo, setPeriodo] = useState<Periodo>(opciones[1]?.p ?? { desde: hoy, hasta: hoy });
  const reporte = useQuery({
    queryKey: ['reportes', clubId, periodo],
    queryFn: () =>
      panel.get<ReporteClub>(`/clubs/${clubId}/reportes?desde=${periodo.desde}&hasta=${periodo.hasta}`),
    placeholderData: (previo) => previo,
  });
  const r = reporte.data;

  return (
    <div className="flex max-w-6xl flex-col gap-4">
      <h1 className="font-display text-[40px] leading-none font-bold">Reportes</h1>

      <search className="flex flex-wrap items-end gap-2" aria-label="Período">
        {opciones.map((o) => {
          const activo = o.p.desde === periodo.desde && o.p.hasta === periodo.hasta;
          return (
            <button
              key={o.nombre}
              type="button"
              aria-pressed={activo}
              onClick={() => setPeriodo(o.p)}
              className={`min-h-11 rounded-xs px-3.5 text-sm font-semibold ${
                activo
                  ? 'bg-noche text-white'
                  : 'border border-linea bg-superficie text-medio hover:text-tinta'
              }`}
            >
              {o.nombre}
            </button>
          );
        })}
        <div className="flex items-end gap-2">
          <Campo
            etiqueta="Desde"
            type="date"
            value={periodo.desde}
            max={periodo.hasta}
            onChange={(e) => e.target.value && setPeriodo({ ...periodo, desde: e.target.value })}
          />
          <Campo
            etiqueta="Hasta"
            type="date"
            value={periodo.hasta}
            min={periodo.desde}
            onChange={(e) => e.target.value && setPeriodo({ ...periodo, hasta: e.target.value })}
          />
        </div>
        <Exportar periodo={periodo} />
      </search>

      {reporte.isError ? <Aviso>{mensajeDe(reporte.error)}</Aviso> : null}
      {!r ? (
        reporte.isPending ? (
          <Cargando />
        ) : null
      ) : (
        <div className={`flex flex-col gap-4 transition-opacity ${reporte.isFetching ? 'opacity-60' : ''}`}>
          <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Tarjeta className="col-span-2">
              <div className="text-sm text-suave">Cobrado</div>
              <div className="text-[44px] font-semibold leading-tight">{pesos(r.dinero.cobrado)}</div>
              <div className="text-sm text-medio">
                Turnos {pesos(r.dinero.cobradoTurnos)} · Cantina {pesos(r.dinero.cobradoCantina)}
              </div>
            </Tarjeta>
            <Dato
              etiqueta="Ocupación"
              valor={porcentaje(r.ocupacion.porcentaje)}
              pie={`${Math.round(r.ocupacion.ocupado / 60)} de ${Math.round(r.ocupacion.disponible / 60)} horas`}
            />
            <Dato
              etiqueta="Partidos jugados"
              valor={String(r.turnos.jugados)}
              pie={`${r.clientes.nuevos} clientes nuevos`}
            />
            <Dato
              etiqueta="Ausentismo"
              valor={porcentaje(r.turnos.ausentismo)}
              pie={`${r.turnos.porEstado.AUSENTE ?? 0} turnos sin venir`}
            />
            <Dato
              etiqueta="Por cobrar"
              valor={pesos(r.dinero.porCobrar)}
              pie={`${r.dinero.turnosConSaldo} turnos jugados con saldo`}
            />
          </section>

          <Tarjeta>
            <h2 className="font-bold">Cobrado por día</h2>
            <p className="mb-2 text-sm text-suave">Turnos y cantina, neto de devoluciones.</p>
            <ColumnasPorDia dias={r.porDia} />
          </Tarjeta>

          <Tarjeta>
            <h2 className="font-bold">Ocupación por día y hora</h2>
            <p className="mb-3 text-sm text-suave">
              Qué parte del horario abierto estuvo reservado, sumando todas las canchas del período.
            </p>
            <MapaOcupacion mapa={r.ocupacion.mapa} />
          </Tarjeta>

          <div className="grid gap-4 lg:grid-cols-2">
            <Tabla
              titulo="Por cancha"
              columnas={['Cancha', 'Ocupación', 'Partidos', 'Facturado']}
              filas={r.ocupacion.porCancha.map((c) => [
                c.nombre,
                c.disponible ? porcentaje(c.ocupado / c.disponible) : '—',
                c.partidos,
                pesos(c.facturado),
              ])}
            />
            <Tabla
              titulo="Cobrado por medio"
              columnas={['Medio', 'Monto']}
              filas={[
                ...Object.entries(r.dinero.porMedio)
                  .sort((a, b) => b[1] - a[1])
                  .map(([m, v]) => [MEDIOS_PAGO[m] ?? m, pesos(v)]),
                ...(r.dinero.devuelto ? [['Devoluciones', `−${pesos(r.dinero.devuelto)}`]] : []),
                ...(r.dinero.descuentosPorPuntos
                  ? [
                      [
                        `Descuentos por puntos (${r.dinero.canjesAplicados})`,
                        `−${pesos(r.dinero.descuentosPorPuntos)}`,
                      ],
                    ]
                  : []),
              ]}
              pie={Object.entries(r.dinero.porConcepto)
                .map(([c, v]) => `${CONCEPTOS[c] ?? c}: ${pesos(v)}`)
                .join(' · ')}
            />
            <Tabla
              titulo="Turnos"
              columnas={['Estado', 'Cantidad']}
              filas={Object.entries(r.turnos.porEstado).map(([e, n]) => [ESTADOS[e] ?? e, n])}
              pie={Object.entries(r.turnos.porOrigen)
                .map(([o, n]) => `${ORIGENES[o] ?? o}: ${n}`)
                .join(' · ')}
            />
            <Tabla
              titulo="Clientes que más juegan"
              columnas={['Cliente', 'Teléfono', 'Partidos']}
              filas={r.clientes.frecuentes.map((c) => [c.nombre, telefonoLegible(c.telefono), c.partidos])}
            />
            <Tabla
              titulo="Más ausencias"
              columnas={['Cliente', 'Teléfono', 'Ausencias']}
              filas={r.clientes.masAusencias.map((c) => [c.nombre, telefonoLegible(c.telefono), c.ausencias])}
            />
            <Tabla
              titulo="Cantina: más vendido"
              columnas={['Producto', 'Unidades', 'Total']}
              filas={r.cantina.masVendidos.map((p) => [p.nombre, p.cantidad, pesos(p.total)])}
              pie={`Mostrador ${pesos(r.cantina.mostrador)} · A cuenta de turnos ${pesos(r.cantina.aCuentaDeTurnos)}`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Dato({ etiqueta, valor, pie }: { etiqueta: string; valor: string; pie: string }) {
  return (
    <Tarjeta>
      <div className="text-sm text-suave">{etiqueta}</div>
      <div className="text-3xl font-semibold leading-tight">{valor}</div>
      <div className="text-sm text-medio">{pie}</div>
    </Tarjeta>
  );
}

function Tabla({
  titulo,
  columnas,
  filas,
  pie,
}: {
  titulo: string;
  columnas: string[];
  filas: ReactNode[][];
  pie?: string;
}) {
  return (
    <Tarjeta>
      <h2 className="mb-2 font-bold">{titulo}</h2>
      {filas.length === 0 ? (
        <p className="text-sm text-suave">Sin datos en el período.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-sm text-suave">
              {columnas.map((c, i) => (
                <th key={c} scope="col" className={`pb-1.5 font-semibold ${i > 0 ? 'text-right' : ''}`}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={String(f[0])} className="border-t border-linea">
                {f.map((v, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: las columnas son fijas.
                  <td key={i} className={`py-1.5 ${i > 0 ? 'text-right' : ''}`}>
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pie ? <p className="mt-2 text-sm text-suave">{pie}</p> : null}
    </Tarjeta>
  );
}

/** Una sola serie: sin leyenda (el título dice qué es). Cada columna tiene su tooltip. */
function ColumnasPorDia({ dias }: { dias: ReporteClub['porDia'] }) {
  const [ref, ancho] = useAncho<HTMLDivElement>();
  const [foco, setFoco] = useState<number | null>(null);
  const [tabla, setTabla] = useState(false);
  const alto = 220;
  const arriba = 10;
  const izq = 64;
  const abajo = 26;
  const maximo = Math.max(...dias.map((d) => d.cobrado), 0);
  const paso = pasoRedondo(maximo || 100_000);
  const tope = Math.max(paso, Math.ceil(maximo / paso) * paso);
  const marcas = Array.from({ length: Math.round(tope / paso) + 1 }, (_, i) => i * paso);
  const banda = ancho > izq ? (ancho - izq) / dias.length : 0;
  const grosor = Math.max(2, Math.min(24, banda - 2));
  const y = (v: number) => (arriba + (alto - abajo - arriba) * (1 - v / tope)) | 0;
  const cadaCuanto = Math.max(1, Math.ceil(dias.length / Math.max(1, Math.floor((ancho - izq) / 56))));
  const activo = foco !== null ? dias[foco] : undefined;

  return (
    <div>
      <div ref={ref} className="relative">
        {ancho > 0 ? (
          <svg width={ancho} height={alto} role="img" aria-label={`Cobrado por día, máximo ${pesos(maximo)}`}>
            {marcas.map((m) => (
              <g key={m}>
                <line
                  x1={izq}
                  x2={ancho}
                  y1={y(m) + 0.5}
                  y2={y(m) + 0.5}
                  stroke="var(--linea)"
                  strokeWidth={1}
                />
                <text x={izq - 8} y={y(m) + 4} textAnchor="end" fontSize={12} fill="var(--tenue)">
                  {pesosCortos(m)}
                </text>
              </g>
            ))}
            {dias.map((d, i) => {
              const x = izq + i * banda + (banda - grosor) / 2;
              const h = alto - abajo - y(d.cobrado);
              const r = Math.min(4, h, grosor / 2);
              return (
                // biome-ignore lint/a11y/useSemanticElements: el área de foco de cada columna vive dentro del SVG.
                <g
                  key={d.fecha}
                  role="button"
                  tabIndex={0}
                  aria-label={`${fechaCorta(d.fecha)}: ${pesos(d.cobrado)}`}
                  onPointerEnter={() => setFoco(i)}
                  onPointerLeave={() => setFoco(null)}
                  onFocus={() => setFoco(i)}
                  onBlur={() => setFoco(null)}
                  className="outline-none"
                >
                  <rect
                    x={izq + i * banda + 1}
                    y={1}
                    width={Math.max(0, banda - 2)}
                    height={alto - abajo - 2}
                    fill="transparent"
                    stroke={foco === i ? 'var(--foco)' : 'none'}
                    strokeWidth={2}
                  />
                  {h > 0 ? (
                    <path
                      d={`M${x},${alto - abajo} V${y(d.cobrado) + r} Q${x},${y(d.cobrado)} ${x + r},${y(d.cobrado)} H${x + grosor - r} Q${x + grosor},${y(d.cobrado)} ${x + grosor},${y(d.cobrado) + r} V${alto - abajo} Z`}
                      fill={COLOR_BARRA}
                      opacity={foco === null || foco === i ? 1 : 0.55}
                    />
                  ) : null}
                  {i % cadaCuanto === 0 ? (
                    <text
                      x={izq + i * banda + banda / 2}
                      y={alto - 8}
                      textAnchor="middle"
                      fontSize={11}
                      fill="var(--tenue)"
                    >
                      {d.fecha.slice(8)}/{d.fecha.slice(5, 7)}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <line
              x1={izq}
              x2={ancho}
              y1={alto - abajo + 0.5}
              y2={alto - abajo + 0.5}
              stroke="var(--borde-control)"
            />
          </svg>
        ) : (
          <div style={{ height: alto }} />
        )}
        {activo && foco !== null ? (
          <div
            role="status"
            className="pointer-events-none absolute top-2 rounded-xs bg-noche px-3 py-2 text-white"
            style={{
              left: Math.min(Math.max(izq + foco * banda + banda / 2 - 70, 0), Math.max(0, ancho - 150)),
            }}
          >
            <div className="text-base font-semibold">{pesos(activo.cobrado)}</div>
            <div className="text-xs text-[#c9d5cc]">
              {fechaCorta(activo.fecha)} · ocupación{' '}
              {activo.disponible ? porcentaje(activo.ocupado / activo.disponible) : '—'}
            </div>
          </div>
        ) : null}
      </div>
      <Boton variante="fantasma" onClick={() => setTabla(!tabla)}>
        {tabla ? 'Ocultar tabla' : 'Ver como tabla'}
      </Boton>
      {tabla ? (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-sm text-suave">
              <th scope="col" className="font-semibold">
                Día
              </th>
              <th scope="col" className="text-right font-semibold">
                Cobrado
              </th>
              <th scope="col" className="text-right font-semibold">
                Ocupación
              </th>
            </tr>
          </thead>
          <tbody>
            {dias.map((d) => (
              <tr key={d.fecha} className="border-t border-linea">
                <td className="py-1">{fechaCorta(d.fecha)}</td>
                <td className="py-1 text-right">{pesos(d.cobrado)}</td>
                <td className="py-1 text-right">
                  {d.disponible ? porcentaje(d.ocupado / d.disponible) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function colorDe(ocupado: number, disponible: number) {
  if (!disponible) return null;
  const p = ocupado / disponible;
  if (p <= 0) return SIN_OCUPAR;
  return RAMPA[Math.min(RAMPA.length - 1, Math.ceil(p * RAMPA.length) - 1)] ?? SIN_OCUPAR;
}

/** Mapa de calor día × hora. Celdas cerradas quedan vacías; el valor exacto está en el tooltip y el título de cada celda. */
function MapaOcupacion({ mapa }: { mapa: ReporteClub['ocupacion']['mapa'] }) {
  const [foco, setFoco] = useState<{ d: number; h: number } | null>(null);
  const horas = Array.from({ length: 24 }, (_, h) => h).filter((h) =>
    mapa.some((fila) => (fila[h]?.disponible ?? 0) > 0),
  );
  // Las horas de madrugada (cierre después de medianoche) van al final, como en la grilla.
  const orden = [...horas.filter((h) => h >= 6), ...horas.filter((h) => h < 6)];
  const celda = foco ? mapa[foco.d]?.[foco.h] : undefined;
  if (orden.length === 0) return <p className="text-sm text-suave">No hubo horario abierto en el período.</p>;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th scope="col" className="sr-only">
                Día
              </th>
              {orden.map((h) => (
                <th key={h} scope="col" className="w-9 text-center text-[11px] font-normal text-suave">
                  {String(h).padStart(2, '0')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ORDEN_SEMANA.map((d) => (
              <tr key={d}>
                <th scope="row" className="pr-2 text-left text-sm font-semibold">
                  {DIAS[d]?.slice(0, 3)}
                </th>
                {orden.map((h) => {
                  const b = mapa[d]?.[h] ?? { disponible: 0, ocupado: 0 };
                  const color = colorDe(b.ocupado, b.disponible);
                  const texto = b.disponible
                    ? `${DIAS[d]} ${String(h).padStart(2, '0')}:00 · ${porcentaje(b.ocupado / b.disponible)} ocupado`
                    : `${DIAS[d]} ${String(h).padStart(2, '0')}:00 · cerrado`;
                  return (
                    <td
                      key={h}
                      tabIndex={b.disponible ? 0 : -1}
                      title={texto}
                      aria-label={texto}
                      onPointerEnter={() => setFoco({ d, h })}
                      onPointerLeave={() => setFoco(null)}
                      onFocus={() => setFoco({ d, h })}
                      onBlur={() => setFoco(null)}
                      className={`h-8 w-9 rounded-[4px] ${foco?.d === d && foco.h === h ? 'outline-2 outline-offset-1 outline-tinta' : ''}`}
                      style={{ background: color ?? 'transparent' }}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-medio">
        <p role="status" className="min-h-5 w-full font-semibold text-tinta">
          {foco && celda
            ? celda.disponible
              ? `${DIAS[foco.d]} ${String(foco.h).padStart(2, '0')}:00 · ${porcentaje(celda.ocupado / celda.disponible)} ocupado (${Math.round(celda.ocupado / 60)} de ${Math.round(celda.disponible / 60)} h)`
              : `${DIAS[foco.d]} ${String(foco.h).padStart(2, '0')}:00 · cerrado`
            : ''}
        </p>
        <span className="flex items-center gap-1.5">
          <span className="size-3.5 rounded-[3px]" style={{ background: SIN_OCUPAR }} /> 0%
        </span>
        {RAMPA.map((c, i) => (
          <span key={c} className="flex items-center gap-1.5">
            <span className="size-3.5 rounded-[3px]" style={{ background: c }} />
            {i * 20 + 1}–{(i + 1) * 20}%
          </span>
        ))}
        <span>Vacío = cerrado</span>
      </div>
    </div>
  );
}

function Exportar({ periodo }: { periodo: Periodo }) {
  const { clubId } = useClubActual();
  const [error, setError] = useState<string | null>(null);
  const bajar = async (tipo: 'turnos' | 'pagos' | 'ventas') => {
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/admin/clubs/${clubId}/reportes/exportar?tipo=${tipo}&desde=${periodo.desde}&hasta=${periodo.hasta}`,
        { credentials: 'include', cache: 'no-store' },
      );
      if (!res.ok) throw new ErrorApi(res.status, 'ERROR', 'No se pudo exportar. Probá de nuevo.');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tipo}-${periodo.desde}-a-${periodo.hasta}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(mensajeDe(e));
    }
  };
  return (
    <div className="ml-auto flex flex-wrap items-center gap-1">
      <span className="text-sm text-suave">Exportar (Excel):</span>
      <Boton variante="fantasma" onClick={() => bajar('turnos')}>
        Turnos
      </Boton>
      <Boton variante="fantasma" onClick={() => bajar('pagos')}>
        Pagos
      </Boton>
      <Boton variante="fantasma" onClick={() => bajar('ventas')}>
        Cantina
      </Boton>
      {error ? <Aviso>{error}</Aviso> : null}
    </div>
  );
}
