'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ErrorApi, mensajeDe, panel } from '@/lib/api';
import { fechaCorta, fechaLocal, hora, linkWhatsApp, pesos, telefonoLegible } from '@/lib/formato';
import type { DetalleTurno as TipoDetalle, VentaCantina } from '@/lib/tipos';
import { IconoWhatsApp } from '../iconos';
import { Aviso, Boton, BotonLink, Cargando, Numero } from '../ui';
import { FormAnular } from './Cantina';
import { Vendedor } from './cantina/Vendedor';
import { Dialogo } from './Dialogo';
import { DialogoCancelar, DialogoCobrar } from './DialogosTurno';
import { actorLegible, apariencia, CLASES, ESTADOS_HISTORIAL, ORIGENES, TEXTOS } from './estados';
import { useClubActual } from './sesion';

type AlHacer = (mensaje: string, o?: { cerrar?: boolean }) => void;

export function DetalleTurno({
  turnoId,
  zona,
  alHacer,
}: {
  turnoId: string;
  zona: string;
  alHacer: AlHacer;
}) {
  const { clubId } = useClubActual();
  const qc = useQueryClient();
  const [dialogo, setDialogo] = useState<'cobrar' | 'cancelar' | 'cantina' | null>(null);
  const [anulando, setAnulando] = useState<VentaCantina | null>(null);
  const detalle = useQuery({
    queryKey: ['turno', clubId, turnoId],
    queryFn: () => panel.get<TipoDetalle>(`/clubs/${clubId}/turnos/${turnoId}`),
  });
  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['agenda', clubId] });
    qc.invalidateQueries({ queryKey: ['turno', clubId, turnoId] });
  };

  const checkin = useMutation({
    mutationFn: (forzar: boolean) =>
      panel.post<{ puntosGanados: number }>(`/clubs/${clubId}/checkin`, { qr: detalle.data?.codigo, forzar }),
    onSuccess: (r) => {
      refrescar();
      alHacer(
        `${detalle.data?.cliente?.nombre ?? 'El turno'} está en cancha.${r.puntosGanados ? ` Sumó ${r.puntosGanados} puntos.` : ''}`,
      );
    },
  });
  const ausente = useMutation({
    mutationFn: () => panel.post(`/clubs/${clubId}/turnos/${turnoId}/ausente`),
    onSuccess: () => {
      refrescar();
      alHacer('Marcado como ausente.');
    },
  });

  if (detalle.isPending) return <Cargando />;
  if (detalle.isError) return <Aviso>{detalle.error.message}</Aviso>;
  const t = detalle.data;
  const senaEnRevision = t.pagos.some((p) => p.estado === 'EN_REVISION');
  const a = apariencia({ ...t, senaEnRevision });
  const empezo = Date.parse(t.inicio) <= Date.now();
  const fueraDeHorario = checkin.error instanceof ErrorApi && checkin.error.codigo === 'FUERA_DE_HORARIO';
  const error = [checkin.error, ausente.error].find(Boolean);

  const esBloqueo = t.origen === 'BLOQUEO';
  const cancelable = t.estado === 'PRE_RESERVADO' || t.estado === 'CONFIRMADO';
  const diaTurno = fechaLocal(t.inicio, zona);

  // Una sola acción principal según el momento del turno; el resto, secundarias.
  let principal: React.ReactNode = null;
  const secundarias: React.ReactNode[] = [];
  if (t.estado === 'CONFIRMADO' && !esBloqueo) {
    principal = (
      <Boton key="checkin" disabled={checkin.isPending} onClick={() => checkin.mutate(fueraDeHorario)}>
        {fueraDeHorario ? 'Hacer el check-in igual' : 'Hacer check-in'}
      </Boton>
    );
    if (t.saldo > 0)
      secundarias.push(
        <Boton key="cobrar" variante="secundario" onClick={() => setDialogo('cobrar')}>
          Cobrar saldo {pesos(t.saldo)}
        </Boton>,
      );
    if (empezo)
      secundarias.push(
        <Boton
          key="ausente"
          variante="secundario"
          disabled={ausente.isPending}
          onClick={() => ausente.mutate()}
        >
          No vino (ausente)
        </Boton>,
      );
  } else if (t.estado === 'PRESENTE' && t.saldo > 0) {
    principal = <Boton onClick={() => setDialogo('cobrar')}>Cobrar saldo {pesos(t.saldo)}</Boton>;
  } else if (t.estado === 'PRE_RESERVADO') {
    principal = senaEnRevision ? (
      <BotonLink href={`/panel/${clubId}/transferencias`}>Revisar el comprobante</BotonLink>
    ) : (
      <Boton onClick={() => setDialogo('cobrar')}>Cobrar la seña en el club ({pesos(t.montoSena)})</Boton>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`rounded-xs px-2 py-0.5 text-sm font-semibold no-underline ${CLASES[a]}`}>
          {TEXTOS[a]}
          {a === 'pendiente' && t.expiraEn ? ` · vence ${hora(t.expiraEn, zona)}` : ''}
        </span>
        {t.origen === 'FIJO' ? (
          <Link
            href={`/panel/${clubId}/turnos-fijos`}
            className="text-sm font-semibold text-acento-texto underline"
          >
            {ORIGENES[t.origen]}
          </Link>
        ) : (
          <span className="text-sm text-tenue">{ORIGENES[t.origen]}</span>
        )}
      </div>
      <h2 className="mt-3 font-display text-[32px] leading-none font-bold">
        {t.cliente?.nombre ?? 'Cancha bloqueada'}
      </h2>
      <p className="mt-1 text-base text-tenue">
        {t.cancha} · {fechaCorta(diaTurno)} · {hora(t.inicio, zona)} a {hora(t.fin, zona)}
      </p>
      {t.cliente ? (
        <a
          href={linkWhatsApp(t.cliente.telefono)}
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 self-start text-base font-semibold text-acento-texto"
        >
          <IconoWhatsApp tamano={18} /> {telefonoLegible(t.cliente.telefono)}
        </a>
      ) : null}
      {t.nota ? <p className="mt-2 border-l-2 border-borde-control pl-3 text-sm">Nota: {t.nota}</p> : null}

      {!esBloqueo ? (
        <dl className="mt-4 grid grid-cols-[1fr_auto] items-baseline gap-y-1.5 border-t border-linea pt-3 text-base">
          <dt className="text-tenue">Precio</dt>
          <dd className="text-right font-semibold">{pesos(t.precioTotal)}</dd>
          {t.consumos > 0 ? (
            <>
              <dt className="text-tenue">Cantina</dt>
              <dd className="text-right font-semibold">{pesos(t.consumos)}</dd>
            </>
          ) : null}
          {t.descuentos > 0 ? (
            <>
              <dt className="text-tenue">Canje de puntos</dt>
              <dd className="text-right font-semibold">−{pesos(t.descuentos)}</dd>
            </>
          ) : null}
          <dt className="text-tenue">Pagado</dt>
          <dd className="text-right font-semibold">{pesos(t.pagado)}</dd>
          <dt className="font-semibold">{t.saldo > 0 ? 'Debe' : 'Saldo'}</dt>
          <dd className={`text-right ${t.saldo > 0 ? 'text-aviso-texto' : ''}`}>
            <Numero className="text-[28px]">{t.saldo > 0 ? pesos(t.saldo) : 'Pagado'}</Numero>
          </dd>
        </dl>
      ) : null}

      {!esBloqueo ? (
        <section aria-label="Cantina del turno" className="mt-3 flex flex-col gap-1.5">
          {t.ventas
            .filter((v) => !v.anuladaEn)
            .map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 flex-1">
                  {v.items.map((i) => `${i.cantidad} × ${i.nombre}`).join(', ')}
                </span>
                <span>{pesos(v.total)}</span>
                <button
                  type="button"
                  onClick={() => setAnulando(v)}
                  className="min-h-11 px-1 text-tenue underline"
                  aria-label={`Anular ${v.items.map((i) => i.nombre).join(', ')}`}
                >
                  anular
                </button>
              </div>
            ))}
          {t.estado === 'CONFIRMADO' || t.estado === 'PRESENTE' ? (
            <Boton variante="fantasma" className="self-start px-0" onClick={() => setDialogo('cantina')}>
              + Cargar de la cantina
            </Boton>
          ) : null}
        </section>
      ) : null}

      {t.cliente && (t.canjes.disponibles.length || t.canjes.aplicados.length) ? (
        <CanjesDelTurno
          turnoId={t.id}
          canjes={t.canjes}
          alHacer={(m) => {
            refrescar();
            alHacer(m);
          }}
        />
      ) : null}

      {error ? (
        <div className="mt-3">
          <Aviso>{mensajeDe(error)}</Aviso>
        </div>
      ) : null}

      {principal || secundarias.length || (cancelable && esBloqueo) ? (
        <div className="mt-4 flex flex-col gap-2">
          {principal}
          {secundarias}
          {cancelable && esBloqueo ? (
            <Boton variante="peligro" onClick={() => setDialogo('cancelar')}>
              Quitar bloqueo
            </Boton>
          ) : null}
        </div>
      ) : null}

      {cancelable && !esBloqueo ? (
        <details className="group mt-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm font-semibold text-tenue hover:text-tinta">
            Más acciones
          </summary>
          <div className="flex flex-col gap-2 pt-1">
            <Boton variante="peligro" onClick={() => setDialogo('cancelar')}>
              Cancelar turno
            </Boton>
          </div>
        </details>
      ) : null}

      <h3 className="mt-5 mb-2 text-base font-semibold">Historial</h3>
      <ol className="flex flex-col gap-1.5 text-sm">
        {t.historial.map((h) => {
          const dia = fechaLocal(h.en, zona);
          return (
            <li key={`${h.en}${h.a}`} className="flex gap-3">
              <span className="w-28 shrink-0 text-tenue">
                {dia === diaTurno ? '' : `${fechaCorta(dia).split(' ')[1]} `}
                {hora(h.en, zona)}
              </span>
              <span>
                {ESTADOS_HISTORIAL[h.a]} · <span className="text-tenue">{actorLegible(h.actor)}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <Dialogo
        abierto={dialogo === 'cantina'}
        alCerrar={() => setDialogo(null)}
        titulo={`Cantina · ${t.cliente?.nombre ?? ''}`}
      >
        {dialogo === 'cantina' ? (
          <Vendedor
            turnoId={t.id}
            alVender={(v) => {
              setDialogo(null);
              refrescar();
              alHacer(`Cargado a la cuenta: ${pesos(v.total)}.`);
            }}
          />
        ) : null}
      </Dialogo>
      <Dialogo abierto={anulando !== null} alCerrar={() => setAnulando(null)} titulo="Anular consumo">
        {anulando ? (
          <FormAnular
            venta={anulando}
            alAnular={() => {
              setAnulando(null);
              refrescar();
            }}
          />
        ) : null}
      </Dialogo>
      <DialogoCobrar
        abierto={dialogo === 'cobrar'}
        turno={t}
        alCerrar={() => setDialogo(null)}
        alCobrar={(m) => {
          setDialogo(null);
          refrescar();
          alHacer(m);
        }}
      />
      <DialogoCancelar
        abierto={dialogo === 'cancelar'}
        turno={t}
        alCerrar={() => setDialogo(null)}
        alCancelar={(m) => {
          setDialogo(null);
          qc.invalidateQueries({ queryKey: ['agenda', clubId] });
          alHacer(m, { cerrar: true });
        }}
      />
    </div>
  );
}

function CanjesDelTurno({
  turnoId,
  canjes,
  alHacer,
}: {
  turnoId: string;
  canjes: TipoDetalle['canjes'];
  alHacer: (m: string) => void;
}) {
  const { clubId } = useClubActual();
  const aplicar = useMutation({
    mutationFn: (canjeId: string) =>
      panel.post<{ montoAplicado: number }>(`/clubs/${clubId}/fidelizacion/canjes/${canjeId}/aplicar`, {
        turnoId,
      }),
    onSuccess: (r) => alHacer(`Canje aplicado: −${pesos(r.montoAplicado)}.`),
  });
  return (
    <section
      aria-label="Canjes de puntos"
      className="mt-3 flex flex-col gap-1.5 border-l-2 border-ok-borde bg-ok-fondo px-3 py-2.5 text-sm text-ok-texto"
    >
      {canjes.aplicados.map((c) => (
        <div key={c.id}>
          Canje aplicado · {c.premio.nombre}: −{pesos(c.montoAplicado)}
        </div>
      ))}
      {canjes.disponibles.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-2">
          <span>Tiene sin usar: {c.premio.nombre}</span>
          <Boton variante="secundario" disabled={aplicar.isPending} onClick={() => aplicar.mutate(c.id)}>
            Aplicar
          </Boton>
        </div>
      ))}
      {aplicar.error ? <Aviso>{mensajeDe(aplicar.error)}</Aviso> : null}
    </section>
  );
}
