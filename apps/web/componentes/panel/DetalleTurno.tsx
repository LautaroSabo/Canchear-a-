'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ErrorApi, mensajeDe, panel } from '@/lib/api';
import { hora, linkWhatsApp, pesos, telefonoLegible } from '@/lib/formato';
import type { DetalleTurno as TipoDetalle, VentaCantina } from '@/lib/tipos';
import { IconoWhatsApp } from '../iconos';
import { Aviso, Boton, Cargando, Numero } from '../ui';
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

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold no-underline ${CLASES[a]}`}>
          {TEXTOS[a]}
          {a === 'pendiente' && t.expiraEn ? ` · vence ${hora(t.expiraEn, zona)}` : ''}
        </span>
        {t.origen === 'FIJO' ? (
          <Link href={`/panel/${clubId}/turnos-fijos`} className="text-xs font-semibold text-cancha">
            {ORIGENES[t.origen]}
          </Link>
        ) : (
          <span className="text-xs text-suave">{ORIGENES[t.origen]}</span>
        )}
      </div>
      <h2 className="mt-2.5 text-xl font-bold">{t.cliente?.nombre ?? 'Cancha bloqueada'}</h2>
      <p className="text-sm text-medio">
        {t.cancha} · {hora(t.inicio, zona)} a {hora(t.fin, zona)}
      </p>
      {t.cliente ? (
        <a
          href={linkWhatsApp(t.cliente.telefono)}
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-cancha"
        >
          <IconoWhatsApp tamano={16} /> {telefonoLegible(t.cliente.telefono)}
        </a>
      ) : null}
      {t.nota ? <p className="mt-2.5 rounded-xl bg-fondo px-3 py-2.5 text-[13px]">Nota: {t.nota}</p> : null}

      {t.origen !== 'BLOQUEO' ? (
        <dl className="mt-3.5 grid grid-cols-[1fr_auto] items-baseline gap-y-1.5 text-sm">
          <dt className="text-suave">Precio</dt>
          <dd className="font-semibold">{pesos(t.precioTotal)}</dd>
          {t.consumos > 0 ? (
            <>
              <dt className="text-suave">Cantina</dt>
              <dd className="font-semibold">{pesos(t.consumos)}</dd>
            </>
          ) : null}
          {t.descuentos > 0 ? (
            <>
              <dt className="text-suave">Canje de puntos</dt>
              <dd className="font-semibold">−{pesos(t.descuentos)}</dd>
            </>
          ) : null}
          <dt className="text-suave">Pagado</dt>
          <dd className="font-semibold">{pesos(t.pagado)}</dd>
          <dt className="font-bold">Saldo a cobrar</dt>
          <dd>
            <Numero className="text-2xl">{pesos(t.saldo)}</Numero>
          </dd>
        </dl>
      ) : null}

      {t.origen !== 'BLOQUEO' ? (
        <section aria-label="Cantina del turno" className="mt-3 flex flex-col gap-1.5">
          {t.ventas
            .filter((v) => !v.anuladaEn)
            .map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="min-w-0 flex-1">
                  {v.items.map((i) => `${i.cantidad} × ${i.nombre}`).join(', ')}
                </span>
                <span>{pesos(v.total)}</span>
                <button
                  type="button"
                  onClick={() => setAnulando(v)}
                  className="text-suave underline"
                  aria-label={`Anular ${v.items.map((i) => i.nombre).join(', ')}`}
                >
                  anular
                </button>
              </div>
            ))}
          {t.estado === 'CONFIRMADO' || t.estado === 'PRESENTE' ? (
            <Boton variante="fantasma" className="self-start" onClick={() => setDialogo('cantina')}>
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

      <div className="mt-4 flex flex-col gap-2">
        {t.estado === 'CONFIRMADO' && t.origen !== 'BLOQUEO' ? (
          <>
            <Boton disabled={checkin.isPending} onClick={() => checkin.mutate(fueraDeHorario)}>
              {fueraDeHorario ? 'Hacer el check-in igual' : 'Hacer check-in'}
            </Boton>
            {t.saldo > 0 ? (
              <Boton variante="secundario" onClick={() => setDialogo('cobrar')}>
                Cobrar saldo {pesos(t.saldo)}
              </Boton>
            ) : null}
            {empezo ? (
              <Boton variante="secundario" disabled={ausente.isPending} onClick={() => ausente.mutate()}>
                No vino (ausente)
              </Boton>
            ) : null}
          </>
        ) : null}
        {t.estado === 'PRESENTE' && t.saldo > 0 ? (
          <Boton onClick={() => setDialogo('cobrar')}>Cobrar saldo {pesos(t.saldo)}</Boton>
        ) : null}
        {t.estado === 'PRE_RESERVADO' ? (
          senaEnRevision ? (
            <Link
              href={`/panel/${clubId}/transferencias`}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-cancha px-4 text-sm font-bold text-white"
            >
              Revisar el comprobante
            </Link>
          ) : (
            <Boton onClick={() => setDialogo('cobrar')}>
              Cobrar la seña en el club ({pesos(t.montoSena)})
            </Boton>
          )
        ) : null}
        {t.estado === 'PRE_RESERVADO' || t.estado === 'CONFIRMADO' ? (
          <Boton variante="peligro" onClick={() => setDialogo('cancelar')}>
            {t.origen === 'BLOQUEO' ? 'Quitar bloqueo' : 'Cancelar turno'}
          </Boton>
        ) : null}
      </div>

      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-suave">Historial</h3>
      <ol className="flex flex-col gap-1.5 text-[13px]">
        {t.historial.map((h) => (
          <li key={`${h.en}${h.a}`} className="flex gap-2.5">
            <span className="w-11 shrink-0 text-suave">{hora(h.en, zona)}</span>
            <span>
              {ESTADOS_HISTORIAL[h.a]} · <span className="text-suave">{actorLegible(h.actor)}</span>
            </span>
          </li>
        ))}
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
      className="mt-3 flex flex-col gap-1.5 rounded-xl bg-cancha-suave px-3 py-2.5 text-[13px]"
    >
      {canjes.aplicados.map((c) => (
        <div key={c.id}>
          ✓ {c.premio.nombre}: −{pesos(c.montoAplicado)}
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
