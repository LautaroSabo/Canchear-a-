'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { mensajeDe, panel } from '@/lib/api';
import { fechaCorta, fechaLocal, hora, linkWhatsApp, pesos, telefonoLegible } from '@/lib/formato';
import type {
  Canje,
  ClienteResumen,
  ConfigFidelizacion,
  FichaCliente,
  Premio,
  TipoPremio,
} from '@/lib/tipos';
import { IconoWhatsApp } from '../iconos';
import { Aviso, Boton, Campo, Cargando, Selector, Tarjeta } from '../ui';
import { Dialogo } from './Dialogo';
import { alcanza, useClubActual } from './sesion';

export const TIPOS_PREMIO: Record<TipoPremio, string> = {
  DESCUENTO_MONTO: 'Descuento en pesos',
  DESCUENTO_PORCENTAJE: 'Descuento en %',
  TURNO_GRATIS: 'Turno gratis',
  PRODUCTO: 'Producto (se entrega en el mostrador)',
};

const MOVIMIENTOS = {
  ACUMULACION: 'Partido',
  CANJE: 'Canje',
  AJUSTE: 'Ajuste',
  REVERSION: 'Canje anulado',
} as const;

export function detallePremio(p: Pick<Premio, 'tipo' | 'valor'>) {
  if (p.tipo === 'DESCUENTO_MONTO') return `${pesos(p.valor)} de descuento en un turno`;
  if (p.tipo === 'DESCUENTO_PORCENTAJE') return `${p.valor}% de descuento en un turno`;
  if (p.tipo === 'TURNO_GRATIS') return 'Un turno sin cargo';
  return 'Se entrega en el mostrador';
}

export function Clientes() {
  const { clubId } = useClubActual();
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [elegido, setElegido] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(texto.trim()), 250);
    return () => clearTimeout(t);
  }, [texto]);
  const resultados = useQuery({
    queryKey: ['clientes', clubId, q],
    queryFn: () => panel.get<ClienteResumen[]>(`/clubs/${clubId}/clientes?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  });

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <h1 className="font-display text-[40px] leading-none font-bold">Clientes y puntos</h1>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex flex-col gap-3 lg:w-80 lg:flex-none">
          <Campo
            etiqueta="Buscar por nombre o teléfono"
            type="search"
            placeholder="Juana, 5555…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          {q.length < 2 ? (
            <p className="text-sm text-suave">Escribí al menos 2 letras o los últimos 4 números.</p>
          ) : resultados.isPending ? (
            <Cargando />
          ) : resultados.isError ? (
            <Aviso>{resultados.error.message}</Aviso>
          ) : resultados.data.length === 0 ? (
            <p className="text-sm text-suave">No encontramos a nadie con eso.</p>
          ) : (
            <ul
              className="flex flex-col divide-y divide-linea rounded-xs border border-linea bg-superficie"
              aria-label="Resultados"
            >
              {resultados.data.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setElegido(c.id)}
                    aria-current={elegido === c.id ? 'true' : undefined}
                    className={`flex w-full items-center justify-between gap-2 px-4 py-3 text-left ${elegido === c.id ? 'bg-cancha-suave' : 'hover:bg-fondo'}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-bold">{c.nombre}</span>
                      <span className="block text-sm text-medio">
                        {telefonoLegible(c.telefono)} · {c.partidos} partidos
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-bold text-cancha">{c.saldoPuntos} pts</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="min-w-0 flex-1">{elegido ? <Ficha key={elegido} clienteId={elegido} /> : null}</div>
      </div>
    </div>
  );
}

function Ficha({ clienteId }: { clienteId: string }) {
  const { clubId, zona, rol } = useClubActual();
  const qc = useQueryClient();
  const [dialogo, setDialogo] = useState<'canjear' | 'ajustar' | { anular: Canje } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const ficha = useQuery({
    queryKey: ['cliente', clubId, clienteId],
    queryFn: () => panel.get<FichaCliente>(`/clubs/${clubId}/clientes/${clienteId}`),
  });
  const refrescar = (m: string) => {
    setDialogo(null);
    setAviso(m);
    qc.invalidateQueries({ queryKey: ['cliente', clubId, clienteId] });
    qc.invalidateQueries({ queryKey: ['clientes', clubId] });
    qc.invalidateQueries({ queryKey: ['agenda', clubId] });
  };

  if (ficha.isPending) return <Cargando />;
  if (ficha.isError) return <Aviso>{ficha.error.message}</Aviso>;
  const c = ficha.data;
  const sinUsar = c.canjes.filter((x) => x.estado === 'EMITIDO');

  return (
    <div className="flex flex-col gap-3">
      <Tarjeta className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{c.nombre}</h2>
            <a
              href={linkWhatsApp(c.telefono)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-cancha"
            >
              <IconoWhatsApp tamano={16} /> {telefonoLegible(c.telefono)}
            </a>
            <div className="mt-1 text-sm text-medio">
              {c.partidos} partidos · {c.ausencias} ausencias · {c.cancelados} cancelados
              {c.ultimo ? ` · último: ${fechaCorta(fechaLocal(c.ultimo, zona))}` : ''}
            </div>
          </div>
          <div className="text-right">
            <div className="font-display text-4xl font-bold text-cancha">{c.saldoPuntos}</div>
            <div className="text-xs text-suave">puntos</div>
          </div>
        </div>
        {aviso ? <Aviso tipo="ok">{aviso}</Aviso> : null}
        <div className="flex flex-wrap gap-2">
          <Boton onClick={() => setDialogo('canjear')}>Canjear premio</Boton>
          {alcanza(rol, 'ADMIN') ? (
            <Boton variante="secundario" onClick={() => setDialogo('ajustar')}>
              Ajustar puntos
            </Boton>
          ) : null}
        </div>
      </Tarjeta>

      {sinUsar.length ? (
        <Tarjeta>
          <h3 className="mb-2 font-bold">Canjes sin usar</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {sinUsar.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {x.premio.nombre} · código <code className="font-bold">{x.codigo}</code>
                  <span className="block text-sm text-suave">
                    Se aplica desde el detalle del turno, en la agenda.
                  </span>
                </span>
                <Boton variante="fantasma" onClick={() => setDialogo({ anular: x })}>
                  Anular
                </Boton>
              </li>
            ))}
          </ul>
        </Tarjeta>
      ) : null}

      <Tarjeta>
        <h3 className="mb-2 font-bold">Movimientos de puntos</h3>
        {c.movimientos.length === 0 ? (
          <p className="text-sm text-suave">Todavía no tiene movimientos.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-linea text-sm">
            {c.movimientos.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-semibold">{MOVIMIENTOS[m.tipo]}</span>
                  {m.turnoInicio
                    ? ` del ${fechaCorta(fechaLocal(m.turnoInicio, zona))} ${hora(m.turnoInicio, zona)}`
                    : ''}
                  {m.premio ? `: ${m.premio}` : ''}
                  {m.promocion ? ` (${m.promocion})` : ''}
                  {m.motivo ? <span className="block text-sm text-suave">{m.motivo}</span> : null}
                </span>
                <span className={`shrink-0 font-bold ${m.puntos > 0 ? 'text-cancha' : 'text-rojo'}`}>
                  {m.puntos > 0 ? '+' : ''}
                  {m.puntos}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      <Dialogo
        abierto={dialogo === 'canjear'}
        alCerrar={() => setDialogo(null)}
        titulo={`Canjear · ${c.nombre}`}
      >
        {dialogo === 'canjear' ? <FormCanje cliente={c} alCanjear={refrescar} /> : null}
      </Dialogo>
      <Dialogo
        abierto={dialogo === 'ajustar'}
        alCerrar={() => setDialogo(null)}
        titulo={`Ajustar puntos · ${c.nombre}`}
      >
        {dialogo === 'ajustar' ? <FormAjuste cliente={c} alAjustar={refrescar} /> : null}
      </Dialogo>
      <Dialogo
        abierto={typeof dialogo === 'object' && dialogo !== null}
        alCerrar={() => setDialogo(null)}
        titulo="Anular canje"
      >
        {typeof dialogo === 'object' && dialogo !== null ? (
          <FormAnularCanje canje={dialogo.anular} alAnular={refrescar} />
        ) : null}
      </Dialogo>
    </div>
  );
}

function FormCanje({ cliente, alCanjear }: { cliente: FichaCliente; alCanjear: (m: string) => void }) {
  const { clubId, zona } = useClubActual();
  const config = useQuery({
    queryKey: ['fidelizacion', clubId],
    queryFn: () => panel.get<ConfigFidelizacion>(`/clubs/${clubId}/fidelizacion`),
  });
  const [premioId, setPremioId] = useState('');
  const [turnoId, setTurnoId] = useState('');
  const premios = (config.data?.premios ?? []).filter((p) => p.activo);
  const premio = premios.find((p) => p.id === premioId);
  const canjear = useMutation({
    mutationFn: () =>
      panel.post<{ codigo: string; estado: string; montoAplicado: number }>(
        `/clubs/${clubId}/fidelizacion/canjes`,
        {
          clienteId: cliente.id,
          premioId,
          ...(turnoId && premio?.tipo !== 'PRODUCTO' ? { turnoId } : {}),
        },
      ),
    onSuccess: (r) =>
      alCanjear(
        premio?.tipo === 'PRODUCTO'
          ? `Canjeado: entregale ${premio.nombre}.`
          : r.estado === 'USADO'
            ? `Canjeado y aplicado al turno: −${pesos(r.montoAplicado)}.`
            : `Canjeado: queda para usar en un turno (código ${r.codigo}).`,
      ),
  });

  if (config.isPending) return <Cargando />;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        canjear.mutate();
      }}
    >
      <p className="text-sm">Tiene {cliente.saldoPuntos} puntos.</p>
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Premio</legend>
        {premios.map((p) => {
          const alcanzaPuntos = cliente.saldoPuntos >= p.costoPuntos;
          const agotado = p.stock !== null && p.stock <= 0;
          return (
            <label
              key={p.id}
              className={`flex items-center gap-3 rounded-xs border px-3 py-2.5 text-sm ${premioId === p.id ? 'border-cancha bg-cancha-suave' : 'border-linea'} ${!alcanzaPuntos || agotado ? 'opacity-50' : ''}`}
            >
              <input
                type="radio"
                name="premio"
                value={p.id}
                checked={premioId === p.id}
                disabled={!alcanzaPuntos || agotado}
                onChange={() => setPremioId(p.id)}
                className="accent-cancha"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{p.nombre}</span>
                <span className="block text-sm text-medio">
                  {detallePremio(p)}
                  {agotado ? ' · agotado' : ''}
                </span>
              </span>
              <span className="shrink-0 font-bold">{p.costoPuntos} pts</span>
            </label>
          );
        })}
      </fieldset>
      {premio && premio.tipo !== 'PRODUCTO' ? (
        <Selector
          etiqueta="Aplicarlo a un turno (opcional)"
          value={turnoId}
          onChange={(e) => setTurnoId(e.target.value)}
          ayuda="Si no elegís, queda guardado y se aplica después desde el detalle del turno."
        >
          <option value="">Más adelante</option>
          {cliente.proximosTurnos.map((t) => (
            <option key={t.id} value={t.id}>
              {fechaCorta(fechaLocal(t.inicio, zona))} {hora(t.inicio, zona)} · {pesos(t.precioTotal)}
            </option>
          ))}
        </Selector>
      ) : null}
      {canjear.error ? <Aviso>{mensajeDe(canjear.error)}</Aviso> : null}
      <Boton type="submit" disabled={!premio || canjear.isPending}>
        {premio ? `Canjear por ${premio.costoPuntos} puntos` : 'Elegí un premio'}
      </Boton>
    </form>
  );
}

function FormAjuste({ cliente, alAjustar }: { cliente: FichaCliente; alAjustar: (m: string) => void }) {
  const { clubId } = useClubActual();
  const [puntos, setPuntos] = useState('');
  const [motivo, setMotivo] = useState('');
  const ajustar = useMutation({
    mutationFn: () =>
      panel.post<{ saldoPuntos: number }>(`/clubs/${clubId}/clientes/${cliente.id}/ajuste-puntos`, {
        puntos: Number(puntos),
        motivo: motivo.trim(),
      }),
    onSuccess: (r) => alAjustar(`Listo: ahora tiene ${r.saldoPuntos} puntos.`),
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        ajustar.mutate();
      }}
    >
      <Campo
        etiqueta="Puntos (negativo para restar)"
        type="number"
        value={puntos}
        onChange={(e) => setPuntos(e.target.value)}
        required
      />
      <Campo
        etiqueta="Motivo"
        value={motivo}
        minLength={2}
        maxLength={200}
        onChange={(e) => setMotivo(e.target.value)}
        required
      />
      {ajustar.error ? <Aviso>{mensajeDe(ajustar.error)}</Aviso> : null}
      <Boton type="submit" disabled={ajustar.isPending}>
        Guardar ajuste
      </Boton>
    </form>
  );
}

function FormAnularCanje({ canje, alAnular }: { canje: Canje; alAnular: (m: string) => void }) {
  const { clubId } = useClubActual();
  const [motivo, setMotivo] = useState('');
  const anular = useMutation({
    mutationFn: () =>
      panel.post(`/clubs/${clubId}/fidelizacion/canjes/${canje.id}/anular`, { motivo: motivo.trim() }),
    onSuccess: () => alAnular(`Canje anulado: se devolvieron ${canje.puntos} puntos.`),
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        anular.mutate();
      }}
    >
      <p className="text-sm">
        {canje.premio.nombre} · se le devuelven {canje.puntos} puntos.
      </p>
      <Campo
        etiqueta="Motivo"
        value={motivo}
        minLength={2}
        maxLength={300}
        onChange={(e) => setMotivo(e.target.value)}
        required
      />
      {anular.error ? <Aviso>{mensajeDe(anular.error)}</Aviso> : null}
      <Boton type="submit" variante="peligro" disabled={anular.isPending}>
        Anular canje
      </Boton>
    </form>
  );
}
