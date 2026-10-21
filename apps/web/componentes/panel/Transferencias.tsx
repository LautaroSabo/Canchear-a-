'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { API_URL, mensajeDe, panel } from '@/lib/api';
import { fechaCorta, fechaLocal, hora, pesos, telefonoLegible } from '@/lib/formato';
import type { Transferencia } from '@/lib/tipos';
import { Aviso, Boton, Cargando, Tarjeta } from '../ui';
import { useClubActual } from './sesion';

type Estado = 'EN_REVISION' | 'APROBADO' | 'RECHAZADO';
const PESTANAS: { estado: Estado; nombre: string }[] = [
  { estado: 'EN_REVISION', nombre: 'Para revisar' },
  { estado: 'APROBADO', nombre: 'Aprobadas' },
  { estado: 'RECHAZADO', nombre: 'Rechazadas' },
];

export function Transferencias() {
  const { clubId } = useClubActual();
  const [estado, setEstado] = useState<Estado>('EN_REVISION');
  const lista = useQuery({
    queryKey: ['transferencias', clubId, estado],
    queryFn: () => panel.get<Transferencia[]>(`/clubs/${clubId}/transferencias?estado=${estado}`),
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[30px] font-bold">Transferencias</h1>
      <div role="tablist" aria-label="Estado" className="flex w-fit gap-1 rounded-xl bg-[#eef1ee] p-1">
        {PESTANAS.map((p) => (
          <button
            key={p.estado}
            type="button"
            role="tab"
            aria-selected={estado === p.estado}
            onClick={() => setEstado(p.estado)}
            className={`min-h-10 rounded-lg px-4 text-sm font-semibold ${estado === p.estado ? 'bg-white shadow-sm' : 'text-medio'}`}
          >
            {p.nombre}
          </button>
        ))}
      </div>
      {lista.isPending ? (
        <Cargando />
      ) : lista.isError ? (
        <Aviso>{lista.error.message}</Aviso>
      ) : lista.data.length === 0 ? (
        <p className="text-suave">
          {estado === 'EN_REVISION' ? 'No hay comprobantes para revisar.' : 'No hay transferencias acá.'}
        </p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {lista.data.map((t) => (
            <li key={t.pagoId}>
              <ItemTransferencia t={t} revisable={estado === 'EN_REVISION'} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ItemTransferencia({ t, revisable }: { t: Transferencia; revisable: boolean }) {
  const { clubId, zona } = useClubActual();
  const qc = useQueryClient();
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['transferencias', clubId] });
    qc.invalidateQueries({ queryKey: ['agenda', clubId] });
  };
  const aprobar = useMutation({
    mutationFn: () => panel.post<{ tipo: string }>(`/clubs/${clubId}/pagos/${t.pagoId}/aprobar`),
    onSuccess: refrescar,
  });
  const rechazar = useMutation({
    mutationFn: () => panel.post(`/clubs/${clubId}/pagos/${t.pagoId}/rechazar`, { motivo: motivo.trim() }),
    onSuccess: refrescar,
  });
  const montoOk = t.monto >= t.turno.montoSena;

  return (
    <Tarjeta className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold">{t.cliente?.nombre ?? 'Cliente'}</h2>
          {t.cliente ? <p className="text-sm text-suave">{telefonoLegible(t.cliente.telefono)}</p> : null}
        </div>
        <div className="text-right text-sm">
          <div className="font-semibold">
            {t.cancha} · {fechaCorta(fechaLocal(t.turno.inicio, zona))} {hora(t.turno.inicio, zona)}
          </div>
          <div className="text-suave">
            Enviada {fechaCorta(fechaLocal(t.enviadaEn, zona))} {hora(t.enviadaEn, zona)}
          </div>
        </div>
      </div>
      <p className="text-sm">
        Tiene que haber transferido <strong>{pesos(t.monto)}</strong>
        {!montoOk ? ' (menos que la seña)' : ''}.
      </p>
      <VistaComprobante pagoId={t.pagoId} />
      {revisable ? (
        rechazando ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              rechazar.mutate();
            }}
          >
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Motivo (se lo mandamos al cliente)
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                required
                minLength={2}
                placeholder="El monto no coincide, no se ve el comprobante…"
                className="min-h-11 rounded-xl border border-[#c9d1cb] px-3 font-normal"
              />
            </label>
            <div className="flex gap-2">
              <Boton type="submit" variante="peligro" disabled={rechazar.isPending}>
                Rechazar
              </Boton>
              <Boton variante="fantasma" onClick={() => setRechazando(false)}>
                Volver
              </Boton>
            </div>
          </form>
        ) : (
          <div className="flex gap-2">
            <Boton className="flex-1" disabled={aprobar.isPending} onClick={() => aprobar.mutate()}>
              {aprobar.isPending ? 'Aprobando…' : 'Aprobar y confirmar el turno'}
            </Boton>
            <Boton variante="peligro" onClick={() => setRechazando(true)}>
              Rechazar
            </Boton>
          </div>
        )
      ) : null}
      {aprobar.data?.tipo === 'REEMBOLSO' ? (
        <Aviso tipo="ambar">
          El horario ya lo había tomado otra persona: la seña quedó en Reembolsos para devolverla.
        </Aviso>
      ) : null}
      {aprobar.error || rechazar.error ? <Aviso>{mensajeDe(aprobar.error ?? rechazar.error)}</Aviso> : null}
    </Tarjeta>
  );
}

/** El comprobante se pide con la cookie de sesión y se muestra desde un blob local. */
function VistaComprobante({ pagoId }: { pagoId: string }) {
  const { clubId } = useClubActual();
  const [url, setUrl] = useState<string | null>(null);
  const [tipo, setTipo] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    let creada: string | null = null;
    const control = new AbortController();
    fetch(`${API_URL}/admin/clubs/${clubId}/pagos/${pagoId}/comprobante`, {
      credentials: 'include',
      signal: control.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const blob = await r.blob();
        creada = URL.createObjectURL(blob);
        setTipo(blob.type);
        setUrl(creada);
      })
      .catch(() => !control.signal.aborted && setError(true));
    return () => {
      control.abort();
      if (creada) URL.revokeObjectURL(creada);
    };
  }, [clubId, pagoId]);

  if (error) return <Aviso>No se pudo cargar el comprobante.</Aviso>;
  if (!url) return <div className="h-48 animate-pulse rounded-xl bg-fondo" />;
  if (tipo === 'application/pdf') {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener"
        className="inline-flex min-h-11 items-center font-semibold text-cancha underline"
      >
        Abrir el comprobante (PDF)
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener">
      {/* biome-ignore lint/performance/noImgElement: imagen privada servida desde un blob local, no optimizable por next/image */}
      <img
        src={url}
        alt="Comprobante de transferencia"
        className="max-h-80 w-full rounded-xl border border-linea object-contain"
      />
    </a>
  );
}
