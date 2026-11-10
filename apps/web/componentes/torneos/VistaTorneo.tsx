'use client';

import type { ReactNode } from 'react';
import { fechaCorta, fechaLocal, hora } from '@/lib/formato';
import type { PartidoTorneo, VistaTorneo } from '@/lib/tipos';
import { Insignia } from '../ui';
import { conSets, letraGrupo, NOMBRE_RONDA } from './comunes';

export { ESTADO_TORNEO, letraGrupo, NOMBRE_RONDA, resumenFormato } from './comunes';

/** "Liga" si es un grupo sin eliminación; "Grupo A" si hay varios; "Tabla" si es uno con cuadro. */
export function tituloGrupo(v: VistaTorneo, numero: number) {
  if (v.torneo.cantidadGrupos > 1) return `Grupo ${letraGrupo(numero)}`;
  return 'Tabla de posiciones';
}

export function Tablas({ vista, destacado }: { vista: VistaTorneo; destacado?: string | null }) {
  const pasan = vista.torneo.clasificanPorGrupo;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {vista.grupos.map((g) => (
        <section key={g.numero} aria-label={tituloGrupo(vista, g.numero)} className="min-w-0">
          <h3 className="mb-2 font-display text-2xl font-bold uppercase">{tituloGrupo(vista, g.numero)}</h3>
          <div className="overflow-x-auto border border-linea">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-linea bg-superficie-2 text-left text-tenue">
                  <th className="w-8 px-2 py-2 text-center font-semibold">#</th>
                  <th className="px-2 py-2 font-semibold">Equipo</th>
                  {(conSets(vista.torneo)
                    ? ['PJ', 'PG', 'PE', 'PP', 'SF', 'SC', 'DS']
                    : ['PJ', 'PG', 'PE', 'PP', 'GF', 'GC', 'DG']
                  ).map((c) => (
                    <th key={c} className="px-1.5 py-2 text-center font-semibold">
                      {c}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-center font-bold text-tinta">Pts</th>
                </tr>
              </thead>
              <tbody>
                {g.tabla.map((f, i) => (
                  <tr
                    key={f.equipo}
                    className={`cifras border-b border-linea last:border-b-0 ${
                      f.equipo === destacado ? 'bg-acento-suave font-semibold' : ''
                    }`}
                  >
                    <td
                      className={`px-2 py-2 text-center ${i < pasan ? 'border-l-[3px] border-acento-texto' : 'border-l-[3px] border-transparent'}`}
                    >
                      {i + 1}
                    </td>
                    <td className="px-2 py-2 font-semibold">{f.nombre}</td>
                    {(
                      [
                        ['pj', f.pj],
                        ['pg', f.pg],
                        ['pe', f.pe],
                        ['pp', f.pp],
                        ['gf', f.gf],
                        ['gc', f.gc],
                        ['dg', f.dg > 0 ? `+${f.dg}` : f.dg],
                      ] as const
                    ).map(([c, n]) => (
                      <td key={c} className="px-1.5 py-2 text-center">
                        {n}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-center font-bold">{f.pts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pasan > 0 ? (
            <p className="mt-1.5 text-sm text-tenue">
              Con la marca a la izquierda: {pasan === 1 ? 'el que pasa' : `los ${pasan} que pasan`} a la
              eliminación.
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function Marcador({ p }: { p: PartidoTorneo }) {
  if (p.estado !== 'JUGADO' || p.golesLocal === null) return <span className="text-tenue">vs</span>;
  return (
    <span className="cifras font-display text-xl font-bold whitespace-nowrap">
      {p.golesLocal} - {p.golesVisitante}
      {p.penalesLocal !== null ? (
        <span className="ml-1 text-sm font-semibold text-tenue">
          ({p.penalesLocal}-{p.penalesVisitante} pen.)
        </span>
      ) : null}
    </span>
  );
}

function Lado({
  e,
  gano,
  destacado,
}: {
  e: PartidoTorneo['local'];
  gano: boolean;
  destacado?: string | null;
}) {
  return (
    <span
      className={`min-w-0 truncate ${gano ? 'font-bold' : ''} ${e && e.id === destacado ? 'text-acento-texto' : ''} ${
        e ? '' : 'text-tenue italic'
      }`}
    >
      {e?.nombre ?? 'A definir'}
    </span>
  );
}

export function cuando(p: PartidoTorneo, zona: string) {
  if (!p.inicio) return null;
  return `${fechaCorta(fechaLocal(p.inicio, zona))} ${hora(p.inicio, zona)}${p.cancha ? ` · ${p.cancha}` : ''}`;
}

export function FilaPartido({
  p,
  zona,
  destacado,
  acciones,
}: {
  p: PartidoTorneo;
  zona: string;
  destacado?: string | null;
  acciones?: ReactNode;
}) {
  const gano = (id?: string) => Boolean(id && p.ganadorId === id && p.estado === 'JUGADO');
  return (
    <li className="flex flex-col gap-1.5 border-b border-linea px-4 py-3 last:border-b-0">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-base">
        <span className="flex min-w-0 justify-end text-right">
          <Lado e={p.local} gano={gano(p.local?.id)} destacado={destacado} />
        </span>
        <Marcador p={p} />
        <span className="flex min-w-0">
          <Lado e={p.visitante} gano={gano(p.visitante?.id)} destacado={destacado} />
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-tenue">
        {cuando(p, zona) ?? (p.fase === 'ELIMINACION' && !p.visitante ? 'Pasa directo' : 'Sin horario')}
        {p.estado === 'JUGADO' ? <Insignia tono="ok">Jugado</Insignia> : null}
        {acciones}
      </div>
    </li>
  );
}

/** Partidos de la fase de grupos, por fecha. */
export function Fixture({
  vista,
  zona,
  destacado,
  acciones,
}: {
  vista: VistaTorneo;
  zona: string;
  destacado?: string | null;
  acciones?: (p: PartidoTorneo) => ReactNode;
}) {
  const deGrupos = vista.partidos.filter(
    (p) => p.fase === 'GRUPOS' && (!destacado || p.local?.id === destacado || p.visitante?.id === destacado),
  );
  const fechas = [...new Set(deGrupos.map((p) => p.fecha ?? 0))].sort((a, b) => a - b);
  if (fechas.length === 0) return null;
  return (
    <div className="flex flex-col gap-5">
      {fechas.map((f) => (
        <section key={f} aria-label={`Fecha ${f}`}>
          <h3 className="mb-2 font-display text-xl font-bold uppercase">Fecha {f}</h3>
          <ul className="border border-linea bg-superficie">
            {deGrupos
              .filter((p) => p.fecha === f)
              .sort((a, b) => (a.inicio ?? '').localeCompare(b.inicio ?? ''))
              .map((p) => (
                <FilaPartido key={p.id} p={p} zona={zona} destacado={destacado} acciones={acciones?.(p)} />
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Cuadro de eliminación, ronda por ronda (de la primera a la final). */
export function Cuadro({
  vista,
  zona,
  destacado,
  acciones,
}: {
  vista: VistaTorneo;
  zona: string;
  destacado?: string | null;
  acciones?: (p: PartidoTorneo) => ReactNode;
}) {
  const elim = vista.partidos.filter((p) => p.fase === 'ELIMINACION');
  if (elim.length === 0) return null;
  const rondas = [...new Set(elim.map((p) => p.ronda ?? 1))].sort((a, b) => b - a);
  const final = elim.find((p) => p.ronda === 1);
  const campeon =
    final?.estado === 'JUGADO' ? (final.ganadorId === final.local?.id ? final.local : final.visitante) : null;
  return (
    <div className="flex flex-col gap-5">
      {campeon ? (
        <div className="border border-acento-texto bg-acento-suave px-5 py-4">
          <p className="text-sm font-semibold text-tenue">Campeón</p>
          <p className="font-display text-4xl font-extrabold uppercase">{campeon.nombre}</p>
        </div>
      ) : null}
      {rondas.map((r) => (
        <section key={r} aria-label={NOMBRE_RONDA[r] ?? `Ronda de ${r * 2}`}>
          <h3 className="mb-2 font-display text-xl font-bold uppercase">
            {NOMBRE_RONDA[r] ?? `Ronda de ${r * 2}`}
          </h3>
          <ul className="border border-linea bg-superficie">
            {elim
              .filter((p) => p.ronda === r)
              .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
              .map((p) => (
                <FilaPartido key={p.id} p={p} zona={zona} destacado={destacado} acciones={acciones?.(p)} />
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
