'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ErrorApi, mensajeDe, panel } from '@/lib/api';
import { hora, linkWhatsApp, pesos, telefonoLegible } from '@/lib/formato';
import type { DetalleTurno as TipoDetalle } from '@/lib/tipos';
import { IconoWhatsApp } from '../iconos';
import { Aviso, Boton, Cargando, Numero } from '../ui';
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
  const [dialogo, setDialogo] = useState<'cobrar' | 'cancelar' | null>(null);
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
      panel.post(`/clubs/${clubId}/checkin`, { qr: detalle.data?.codigo, forzar }),
    onSuccess: () => {
      refrescar();
      alHacer(`${detalle.data?.cliente?.nombre ?? 'El turno'} está en cancha.`);
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
          <dt className="text-suave">Pagado</dt>
          <dd className="font-semibold">{pesos(t.pagado)}</dd>
          <dt className="font-bold">Saldo a cobrar</dt>
          <dd>
            <Numero className="text-2xl">{pesos(t.saldo)}</Numero>
          </dd>
        </dl>
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
