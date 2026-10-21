'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { API_URL, panel } from '@/lib/api';
import { fechaLarga, fechaLocal, hora, hoyEn, pesos, sumarDias } from '@/lib/formato';
import { useAhora, useEventosTurnos } from '@/lib/hooks';
import type { Agenda as TipoAgenda, TurnoAgenda } from '@/lib/tipos';
import { IconoDerecha, IconoEscanear, IconoIzquierda } from '../iconos';
import { Aviso, Boton, Cargando, Numero } from '../ui';
import { DetalleTurno } from './DetalleTurno';
import { DialogoNuevo, type Prefill } from './DialogosTurno';
import { apariencia, CLASES, TEXTOS } from './estados';
import { useClubActual } from './sesion';

const PX_HORA = 48;

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
    router.replace(`${ruta}?fecha=${f}`);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Boton
            variante="secundario"
            className="w-10 px-0"
            aria-label="Día anterior"
            onClick={() => irA(sumarDias(fecha, -1))}
          >
            <IconoIzquierda tamano={18} />
          </Boton>
          <h1 className="mx-1.5 font-display text-[30px] font-bold">{fechaLarga(fecha)}</h1>
          <Boton
            variante="secundario"
            className="w-10 px-0"
            aria-label="Día siguiente"
            onClick={() => irA(sumarDias(fecha, 1))}
          >
            <IconoDerecha tamano={18} />
          </Boton>
          {fecha === hoy ? (
            <span className="ml-1.5 rounded-full bg-cancha-suave px-2.5 py-1 text-xs font-bold text-cancha-oscuro">
              HOY · en vivo
            </span>
          ) : (
            <Boton variante="fantasma" onClick={() => irA(hoy)}>
              Volver a hoy
            </Boton>
          )}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Link
            href={`/panel/${clubId}/checkin`}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border-[1.5px] border-borde bg-white px-3.5 text-sm font-semibold hover:border-medio"
          >
            <IconoEscanear tamano={18} /> Escanear QR
          </Link>
          <Boton onClick={() => setNuevo({ canchaId: agenda.data?.canchas[0]?.id ?? '', hora: '20:00' })}>
            + Nuevo turno
          </Boton>
        </div>
      </div>

      {aviso ? (
        <div
          className="mb-3.5 flex items-center gap-3 rounded-xl bg-noche px-4 py-3 text-sm text-white"
          role="status"
        >
          <span className="flex-1">{aviso}</span>
          <button
            type="button"
            onClick={() => setAviso(null)}
            className="min-h-9 rounded-lg border border-[#3a4a40] px-3 text-[13px]"
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
          <Totales agenda={agenda.data} />
          <div className="flex flex-wrap items-start gap-4">
            <section
              aria-label="Agenda por cancha"
              className="min-w-0 flex-[999_1_560px] overflow-x-auto rounded-2xl border border-linea bg-white p-3.5"
            >
              <Leyenda />
              <Linea
                agenda={agenda.data}
                esHoy={fecha === hoy}
                sel={sel}
                setSel={setSel}
                nuevo={(p) => setNuevo(p)}
              />
            </section>
            <aside
              aria-label="Detalle del turno"
              className="min-w-0 flex-[1_1_320px] rounded-2xl border border-linea bg-white p-4.5"
            >
              {sel ? (
                <DetalleTurno
                  turnoId={sel}
                  zona={agenda.data.zonaHoraria}
                  alHacer={(mensaje, { cerrar } = {}) => {
                    setAviso(mensaje);
                    if (cerrar) setSel(null);
                  }}
                />
              ) : (
                <>
                  <h2 className="mb-1.5 text-[17px] font-bold">Detalle del turno</h2>
                  <p className="text-sm leading-relaxed text-suave">
                    Tocá un turno para ver el cliente, lo que pagó y las acciones. Tocá un hueco libre para
                    cargar un turno.
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

function Totales({ agenda }: { agenda: TipoAgenda }) {
  const reales = agenda.turnos.filter((t) => t.origen !== 'BLOQUEO');
  const minutos = (t: { inicio: string; fin: string }) => (Date.parse(t.fin) - Date.parse(t.inicio)) / 60_000;
  const abierto = agenda.apertura.reduce((s, v) => s + minutos(v), 0) * agenda.canchas.length;
  const bloqueado = agenda.turnos.filter((t) => t.origen === 'BLOQUEO').reduce((s, t) => s + minutos(t), 0);
  const ocupado = reales.reduce((s, t) => s + minutos(t), 0);
  const ocupacion = abierto - bloqueado > 0 ? Math.round((ocupado / (abierto - bloqueado)) * 100) : 0;
  const items = [
    ['Turnos del día', String(reales.length)],
    ['Ocupación', `${ocupacion}%`],
    ['Señas sin confirmar', String(reales.filter((t) => t.estado === 'PRE_RESERVADO').length)],
    [
      'A cobrar en el club',
      pesos(reales.filter((t) => t.estado !== 'PRE_RESERVADO').reduce((s, t) => s + t.saldo, 0)),
    ],
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map(([nombre, valor]) => (
        <div key={nombre} className="rounded-xl border border-linea bg-white px-3.5 py-3">
          <div className="text-xs font-semibold text-suave">{nombre}</div>
          <Numero className="block text-[30px]">{valor}</Numero>
        </div>
      ))}
    </div>
  );
}

function Leyenda() {
  return (
    <div className="mb-3 ml-1 flex flex-wrap gap-3.5 text-xs text-medio">
      {(['confirmado', 'presente', 'pendiente', 'revision', 'bloqueo'] as const).map((a) => (
        <span key={a} className="inline-flex items-center gap-1.5">
          <span className={`size-3.5 rounded ${CLASES[a]}`} aria-hidden="true" />
          {TEXTOS[a]}
        </span>
      ))}
    </div>
  );
}

function Linea({
  agenda,
  esHoy,
  sel,
  setSel,
  nuevo,
}: {
  agenda: TipoAgenda;
  esHoy: boolean;
  sel: string | null;
  setSel: (id: string) => void;
  nuevo: (p: Prefill) => void;
}) {
  const ahora = useAhora(30_000);
  const zona = agenda.zonaHoraria;
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
  const desde = inicios.length
    ? Math.floor(Math.min(...inicios) / 3_600_000) * 3_600_000
    : base + 11 * 3_600_000;
  const hasta = fines.length ? Math.ceil(Math.max(...fines) / 3_600_000) * 3_600_000 : desde + 12 * 3_600_000;
  const horas = Math.max(1, (hasta - desde) / 3_600_000);
  const alto = horas * PX_HORA;
  const marcas = Array.from({ length: horas + 1 }, (_, i) => desde + i * 3_600_000);
  const y = (ms: number) => ((ms - desde) / 3_600_000) * PX_HORA;

  return (
    <div
      className="grid min-w-[600px]"
      style={{ gridTemplateColumns: `52px repeat(${agenda.canchas.length}, minmax(170px, 1fr))` }}
    >
      <div />
      {agenda.canchas.map((c) => (
        <div key={c.id} className="px-2 pb-2.5 pt-1.5 text-sm font-bold">
          {c.nombre} <span className="text-xs font-medium text-suave">F{c.jugadoresPorLado}</span>
        </div>
      ))}
      <div className="relative" style={{ height: alto }}>
        {marcas.map((ms, i) => (
          <div
            key={ms}
            className="absolute right-2 text-xs font-semibold text-suave"
            style={{ top: i * PX_HORA - 7 }}
          >
            {hora(new Date(ms), zona)}
          </div>
        ))}
      </div>
      {agenda.canchas.map((c) => (
        <div
          key={c.id}
          className="relative border-l border-linea"
          style={{
            height: alto,
            backgroundImage: `repeating-linear-gradient(to bottom, #fff 0, #fff ${PX_HORA - 1}px, #eef1ee ${PX_HORA - 1}px, #eef1ee ${PX_HORA}px)`,
          }}
        >
          {/* Hueco libre → nuevo turno en esa cancha y hora. */}
          <button
            type="button"
            aria-label={`Cargar un turno en ${c.nombre}`}
            className="absolute inset-0 cursor-copy"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ms = desde + Math.floor((e.clientY - rect.top) / PX_HORA) * 3_600_000;
              nuevo({
                canchaId: c.id,
                hora: hora(new Date(ms), zona),
                fecha: fechaLocal(new Date(ms), zona),
              });
            }}
          />
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
                onClick={() => setSel(t.id)}
              />
            ))}
          {esHoy && ahora >= desde && ahora <= hasta ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 h-0.5 bg-[#c4320a]"
              style={{ top: y(ahora) }}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Bloque({
  t,
  zona,
  top,
  alto,
  elegido,
  onClick,
}: {
  t: TurnoAgenda;
  zona: string;
  top: number;
  alto: number;
  elegido: boolean;
  onClick: () => void;
}) {
  const a = apariencia(t);
  const sub =
    a === 'bloqueo'
      ? (t.nota ?? 'Bloqueada')
      : a === 'pendiente'
        ? `Vence ${t.expiraEn ? hora(t.expiraEn, zona) : ''}`
        : a === 'revision'
          ? 'Revisar comprobante'
          : t.saldo > 0
            ? `Saldo ${pesos(t.saldo)}`
            : 'Todo pago';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={elegido}
      aria-label={`${t.cliente?.nombre ?? 'Bloqueo'}, ${hora(t.inicio, zona)}, ${TEXTOS[a]}`}
      className={`absolute inset-x-1 overflow-hidden rounded-lg px-2 py-1 text-left ${CLASES[a]} ${elegido ? 'outline-3 outline-offset-1 outline-tinta' : ''}`}
      style={{ top: top + 2, height: Math.max(alto - 4, 22) }}
    >
      <span className="block text-xs font-semibold opacity-85">
        {hora(t.inicio, zona)}–{hora(t.fin, zona)}
      </span>
      <span className="block truncate text-sm font-bold">{t.cliente?.nombre ?? 'Bloqueada'}</span>
      <span className="block truncate text-xs font-medium">{sub}</span>
    </button>
  );
}
