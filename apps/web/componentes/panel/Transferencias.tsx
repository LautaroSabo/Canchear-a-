'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { API_URL, mensajeDe, panel } from '@/lib/api';
import { fechaCorta, fechaLocal, hora, pesos, telefonoLegible } from '@/lib/formato';
import type { Transferencia } from '@/lib/tipos';
import { Aviso, Boton, Cargando, EncabezadoPagina, EstadoVacio, Pestanas } from '../ui';
import { useClubActual } from './sesion';

type Estado = 'EN_REVISION' | 'APROBADO' | 'RECHAZADO';

export function Transferencias() {
  const { clubId } = useClubActual();
  const [estado, setEstado] = useState<Estado>('EN_REVISION');
  const [elegida, setElegida] = useState<string | null>(null);
  const lista = useQuery({
    queryKey: ['transferencias', clubId, estado],
    queryFn: () => panel.get<Transferencia[]>(`/clubs/${clubId}/transferencias?estado=${estado}`),
  });
  const pendientes = useQuery({
    queryKey: ['transferencias', clubId, 'EN_REVISION'],
    queryFn: () => panel.get<Transferencia[]>(`/clubs/${clubId}/transferencias?estado=EN_REVISION`),
  });
  const datos = lista.data ?? [];
  const actual = datos.find((t) => t.pagoId === elegida) ?? datos[0];

  return (
    <div className="flex flex-col gap-6">
      <EncabezadoPagina
        titulo="Transferencias"
        bajada="Mirá el comprobante, compará el monto con la seña y aprobá o rechazá. El cliente se entera por WhatsApp."
      />
      <Pestanas
        id="transferencias"
        etiqueta="Estado"
        valor={estado}
        onCambio={(v) => {
          setEstado(v);
          setElegida(null);
        }}
        opciones={[
          { valor: 'EN_REVISION', etiqueta: 'Para revisar', cuenta: pendientes.data?.length ?? 0 },
          { valor: 'APROBADO', etiqueta: 'Aprobadas' },
          { valor: 'RECHAZADO', etiqueta: 'Rechazadas' },
        ]}
      />
      <div id="transferencias-panel" role="tabpanel" aria-labelledby={`transferencias-tab-${estado}`}>
        {lista.isPending ? (
          <Cargando />
        ) : lista.isError ? (
          <Aviso>{lista.error.message}</Aviso>
        ) : !actual ? (
          <EstadoVacio
            titulo={
              estado === 'EN_REVISION' ? 'No hay comprobantes para revisar.' : 'No hay transferencias acá.'
            }
          >
            {estado === 'EN_REVISION'
              ? 'Cuando un cliente suba un comprobante aparece acá y en el menú se marca la cantidad.'
              : null}
          </EstadoVacio>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
            <ul aria-label="Comprobantes" className="flex flex-col border border-linea bg-superficie">
              {datos.map((t) => (
                <li key={t.pagoId} className="border-b border-linea last:border-b-0">
                  <FilaCola
                    t={t}
                    elegida={t.pagoId === actual.pagoId}
                    onElegir={() => setElegida(t.pagoId)}
                  />
                </li>
              ))}
            </ul>
            <Revision
              key={actual.pagoId}
              t={actual}
              revisable={estado === 'EN_REVISION'}
              alTerminar={() => setElegida(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function FilaCola({ t, elegida, onElegir }: { t: Transferencia; elegida: boolean; onElegir: () => void }) {
  const { zona } = useClubActual();
  return (
    <button
      type="button"
      aria-pressed={elegida}
      onClick={onElegir}
      className={`flex w-full flex-col gap-0.5 border-l-[3px] px-4 py-3 text-left ${
        elegida ? 'border-acento bg-acento-suave' : 'border-transparent hover:bg-fondo'
      }`}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-base font-semibold">{t.cliente?.nombre ?? 'Cliente'}</span>
        <span className="shrink-0 text-base font-semibold">{pesos(t.monto)}</span>
      </span>
      <span className="text-sm text-tenue">
        {fechaCorta(fechaLocal(t.turno.inicio, zona))} {hora(t.turno.inicio, zona)} · {t.cancha}
      </span>
    </button>
  );
}

function Revision({
  t,
  revisable,
  alTerminar,
}: {
  t: Transferencia;
  revisable: boolean;
  alTerminar: () => void;
}) {
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
    onSuccess: (r) => {
      refrescar();
      if (r.tipo !== 'REEMBOLSO') alTerminar();
    },
  });
  const rechazar = useMutation({
    mutationFn: () => panel.post(`/clubs/${clubId}/pagos/${t.pagoId}/rechazar`, { motivo: motivo.trim() }),
    onSuccess: () => {
      refrescar();
      alTerminar();
    },
  });
  const coincide = t.monto >= t.turno.montoSena;
  const refRevision = useRef<HTMLElement>(null);

  // Atajos para revisar de corrido: con el foco dentro de esta revisión, A aprueba y R abre
  // el rechazo. No mientras se escribe ni con la tecla sostenida.
  const tecla = (e: React.KeyboardEvent) => {
    if (!revisable || rechazando || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return;
    if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      if (!aprobar.isPending) aprobar.mutate();
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      setRechazando(true);
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: atajos de teclado para los botones de adentro.
    <section
      onKeyDown={tecla}
      tabIndex={-1}
      ref={refRevision}
      id="revision-transferencia"
      aria-label={`Comprobante de ${t.cliente?.nombre ?? 'cliente'}`}
      className="flex flex-col gap-4 border border-linea bg-superficie p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[32px] leading-none font-bold">
            {t.cliente?.nombre ?? 'Cliente'}
          </h2>
          {t.cliente ? (
            <p className="mt-1 text-base text-tenue">{telefonoLegible(t.cliente.telefono)}</p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-base font-semibold">
            {t.cancha} · {fechaCorta(fechaLocal(t.turno.inicio, zona))} {hora(t.turno.inicio, zona)}
          </p>
          <p className="text-sm text-tenue">
            Enviada {fechaCorta(fechaLocal(t.enviadaEn, zona))} {hora(t.enviadaEn, zona)}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="border border-linea px-3 py-2">
          <dt className="text-sm text-tenue">Seña del turno</dt>
          <dd className="font-display text-[28px] leading-tight font-bold">{pesos(t.turno.montoSena)}</dd>
        </div>
        <div className="border border-linea px-3 py-2">
          <dt className="text-sm text-tenue">Tiene que haber transferido</dt>
          <dd className="font-display text-[28px] leading-tight font-bold">{pesos(t.monto)}</dd>
        </div>
        <div
          className={`col-span-2 border px-3 py-2 sm:col-span-1 ${
            coincide
              ? 'border-ok-borde bg-ok-fondo text-ok-texto'
              : 'border-aviso-borde bg-aviso-fondo text-aviso-texto'
          }`}
        >
          <dt className="text-sm">Control</dt>
          <dd className="text-base font-semibold">{coincide ? 'Cubre la seña' : 'Es menos que la seña'}</dd>
        </div>
      </dl>

      <VistaComprobante pagoId={t.pagoId} />

      {revisable ? (
        rechazando ? (
          <form
            className="flex flex-col gap-3"
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
                // biome-ignore lint/a11y/noAutofocus: el foco va al motivo al abrir el rechazo.
                autoFocus
                placeholder="El monto no coincide, no se ve el comprobante…"
                className="min-h-11 rounded-xs border border-borde-control bg-superficie px-3 text-base font-normal"
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
          <div className="flex flex-wrap items-center gap-2">
            <Boton grande className="flex-1" disabled={aprobar.isPending} onClick={() => aprobar.mutate()}>
              {aprobar.isPending ? 'Aprobando…' : 'Aprobar y confirmar el turno'}
            </Boton>
            <Boton grande variante="peligro" onClick={() => setRechazando(true)}>
              Rechazar
            </Boton>
            <p className="w-full text-sm text-tenue">
              Con el foco en este comprobante: <kbd className="font-semibold text-tinta">A</kbd> aprueba,{' '}
              <kbd className="font-semibold text-tinta">R</kbd> rechaza.
            </p>
          </div>
        )
      ) : null}
      {aprobar.data?.tipo === 'REEMBOLSO' ? (
        <Aviso tipo="ambar">
          El horario ya lo había tomado otra persona: la seña quedó en Reembolsos para devolverla.
        </Aviso>
      ) : null}
      {aprobar.error || rechazar.error ? <Aviso>{mensajeDe(aprobar.error ?? rechazar.error)}</Aviso> : null}
    </section>
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

  if (error)
    return (
      <Aviso>
        No pudimos mostrar el comprobante.{' '}
        {url ? (
          <a href={url} target="_blank" rel="noopener" className="font-semibold underline">
            Abrirlo en otra pestaña
          </a>
        ) : null}
      </Aviso>
    );
  if (!url) return <div className="h-96 animate-pulse bg-fondo" />;
  if (tipo === 'application/pdf') {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener"
        className="inline-flex min-h-11 items-center font-semibold text-acento-texto underline"
      >
        Abrir el comprobante (PDF)
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener" className="block bg-fondo">
      {/* biome-ignore lint/performance/noImgElement: imagen privada servida desde un blob local, no optimizable por next/image */}
      <img
        src={url}
        alt="Comprobante de transferencia"
        onError={() => setError(true)}
        className="mx-auto max-h-[60vh] min-h-48 w-full object-contain"
      />
    </a>
  );
}
