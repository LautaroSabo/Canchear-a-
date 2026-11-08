'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { mensajeDe, panel } from '@/lib/api';
import { fechaCorta, fechaLocal, hora, telefonoLegible } from '@/lib/formato';
import type { MensajeCliente } from '@/lib/tipos';
import { Aviso, Boton, Cargando, EncabezadoPagina, EstadoVacio, Insignia, Pestanas, type Tono } from '../ui';
import { useClubActual } from './sesion';

type Filtro = 'todos' | 'FALLIDA' | 'PENDIENTE';

type Configurados = { whatsapp: boolean; correo: boolean };

/** Con el medio sin configurar, el worker los marca "enviados" pero al cliente no le llegó nada. */
function estadoVisible(m: MensajeCliente, c: Configurados): { texto: string; tono: Tono } {
  if (m.estado === 'FALLIDA') return { texto: 'No se pudo mandar', tono: 'error' };
  if (m.estado === 'PENDIENTE') return { texto: 'Por salir', tono: 'aviso' };
  if (m.canal === 'EMAIL' && !c.correo) return { texto: 'No enviado · mail sin configurar', tono: 'neutro' };
  if (m.canal === 'WHATSAPP' && !c.whatsapp)
    return { texto: 'No enviado · WhatsApp sin conectar', tono: 'neutro' };
  return { texto: 'Enviado', tono: 'ok' };
}

export function Mensajes() {
  const { clubId, zona } = useClubActual();
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const datos = useQuery({
    queryKey: ['mensajes', clubId, filtro],
    queryFn: () =>
      panel.get<{ whatsappConfigurado: boolean; correoConfigurado: boolean; mensajes: MensajeCliente[] }>(
        `/clubs/${clubId}/mensajes${filtro !== 'todos' ? `?estado=${filtro}` : ''}`,
      ),
    refetchInterval: 10_000,
  });
  const reintentar = useMutation({
    mutationFn: (id: string) => panel.post(`/clubs/${clubId}/mensajes/${id}/reintentar`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mensajes', clubId] }),
  });
  const configurados = {
    whatsapp: datos.data?.whatsappConfigurado ?? true,
    correo: datos.data?.correoConfigurado ?? true,
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <EncabezadoPagina
        titulo="Mensajes a clientes"
        bajada="Lo que la app le manda a cada cliente. Por mail van las confirmaciones, cancelaciones y devoluciones (si dejó su email al reservar); por WhatsApp, solo el aviso de que se liberó un lugar de la lista de espera."
      />
      {datos.data && (!datos.data.correoConfigurado || !datos.data.whatsappConfigurado) ? (
        <Aviso tipo="ambar">
          {!datos.data.correoConfigurado && !datos.data.whatsappConfigurado
            ? 'Ni el mail ni WhatsApp están configurados: '
            : !datos.data.correoConfigurado
              ? 'El mail todavía no está configurado: '
              : 'WhatsApp todavía no está conectado: '}
          esos mensajes <strong>no les llegan a los clientes</strong>, solo quedan registrados acá.
        </Aviso>
      ) : null}
      <Pestanas
        id="mensajes"
        etiqueta="Filtrar mensajes"
        valor={filtro}
        onCambio={setFiltro}
        opciones={[
          { valor: 'todos', etiqueta: 'Todos' },
          { valor: 'FALLIDA', etiqueta: 'Con error' },
          { valor: 'PENDIENTE', etiqueta: 'Por salir' },
        ]}
      />
      <div
        id="mensajes-panel"
        role="tabpanel"
        aria-labelledby={`mensajes-tab-${filtro}`}
        className="flex flex-col gap-4"
      >
        {reintentar.error ? <Aviso>{mensajeDe(reintentar.error)}</Aviso> : null}
        {datos.isPending ? (
          <Cargando />
        ) : datos.isError ? (
          <Aviso>{datos.error.message}</Aviso>
        ) : datos.data.mensajes.length === 0 ? (
          <EstadoVacio titulo="No hay mensajes acá." />
        ) : (
          <ul className="flex flex-col border border-linea bg-superficie">
            {datos.data.mensajes.map((m) => {
              const e = estadoVisible(m, configurados);
              return (
                <li
                  key={m.id}
                  className="flex min-w-0 flex-col gap-2 border-b border-linea px-4 py-4 last:border-b-0"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 text-base">
                      <span className="font-semibold">{m.cliente ?? 'Cliente'}</span>{' '}
                      <span className="text-tenue">
                        {m.canal === 'EMAIL' ? m.destino : telefonoLegible(m.destino)} ·{' '}
                        {m.canal === 'EMAIL' ? 'mail' : 'WhatsApp'}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-sm text-tenue">
                      {fechaCorta(fechaLocal(m.creadoEn, zona))} {hora(m.creadoEn, zona)}
                      <Insignia tono={e.tono}>{e.texto}</Insignia>
                    </span>
                  </div>
                  <p className="border-l-2 border-linea pl-3 text-sm break-words whitespace-pre-wrap">
                    {m.texto}
                  </p>
                  {m.estado === 'FALLIDA' ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-error-texto">
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
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
