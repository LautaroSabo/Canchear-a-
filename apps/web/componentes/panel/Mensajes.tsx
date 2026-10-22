'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { mensajeDe, panel } from '@/lib/api';
import { fechaCorta, fechaLocal, hora, telefonoLegible } from '@/lib/formato';
import type { MensajeCliente } from '@/lib/tipos';
import { Aviso, Boton, Cargando } from '../ui';
import { useClubActual } from './sesion';

const FILTROS = [
  { id: '', nombre: 'Todos' },
  { id: 'FALLIDA', nombre: 'Con error' },
  { id: 'PENDIENTE', nombre: 'Por salir' },
] as const;

const ESTADOS: Record<MensajeCliente['estado'], { texto: string; clase: string }> = {
  ENVIADA: { texto: 'Enviado', clase: 'bg-cancha-suave text-cancha-oscuro' },
  PENDIENTE: { texto: 'Por salir', clase: 'bg-ambar-fondo text-ambar-texto' },
  FALLIDA: { texto: 'No se pudo mandar', clase: 'bg-[#fdecea] text-[#7a1a0c]' },
};

export function Mensajes() {
  const { clubId, zona } = useClubActual();
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]['id']>('');
  const datos = useQuery({
    queryKey: ['mensajes', clubId, filtro],
    queryFn: () =>
      panel.get<{ whatsappConfigurado: boolean; mensajes: MensajeCliente[] }>(
        `/clubs/${clubId}/mensajes${filtro ? `?estado=${filtro}` : ''}`,
      ),
    refetchInterval: 10_000,
  });
  const reintentar = useMutation({
    mutationFn: (id: string) => panel.post(`/clubs/${clubId}/mensajes/${id}/reintentar`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mensajes', clubId] }),
  });

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="font-display text-[30px] font-bold">Mensajes a clientes</h1>
      {datos.data && !datos.data.whatsappConfigurado ? (
        <Aviso tipo="ambar">
          WhatsApp todavía no está configurado: los mensajes <strong>no les llegan a los clientes</strong>.
          Figuran como enviados pero solo se registran acá (y en la consola del worker). Para activarlo, seguí
          docs/whatsapp.md.
        </Aviso>
      ) : null}
      <div role="tablist" aria-label="Filtrar mensajes" className="flex gap-1">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filtro === f.id}
            onClick={() => setFiltro(f.id)}
            className={`min-h-11 rounded-xl px-3.5 text-sm font-semibold ${
              filtro === f.id
                ? 'bg-noche text-white'
                : 'border border-linea bg-white text-medio hover:text-tinta'
            }`}
          >
            {f.nombre}
          </button>
        ))}
      </div>
      {reintentar.error ? <Aviso>{mensajeDe(reintentar.error)}</Aviso> : null}
      {datos.isPending ? (
        <Cargando />
      ) : datos.isError ? (
        <Aviso>{datos.error.message}</Aviso>
      ) : datos.data.mensajes.length === 0 ? (
        <p className="text-sm text-suave">No hay mensajes.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-linea rounded-2xl border border-linea bg-white">
          {datos.data.mensajes.map((m) => (
            <li key={m.id} className="flex flex-col gap-1.5 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-bold">
                  {m.cliente ?? 'Cliente'} ·{' '}
                  <span className="font-normal text-medio">{telefonoLegible(m.destino)}</span>
                </span>
                <span className="flex items-center gap-2 text-[13px] text-suave">
                  {fechaCorta(fechaLocal(m.creadoEn, zona))} {hora(m.creadoEn, zona)}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${ESTADOS[m.estado].clase}`}>
                    {ESTADOS[m.estado].texto}
                  </span>
                </span>
              </div>
              <p className="whitespace-pre-wrap rounded-xl bg-fondo px-3 py-2 text-sm">{m.texto}</p>
              {m.estado === 'FALLIDA' ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-[#7a1a0c]">
                  <span className="min-w-0 break-words">
                    {m.intentos} intentos · {m.error}
                  </span>
                  <Boton
                    variante="secundario"
                    disabled={reintentar.isPending}
                    onClick={() => reintentar.mutate(m.id)}
                  >
                    Reintentar
                  </Boton>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
