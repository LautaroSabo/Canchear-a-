'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { mensajeDe, panel, pedir } from '@/lib/api';
import type { ClubPublico } from '@/lib/tipos';
import { Aviso, Boton, Campo, Cargando, Tarjeta } from '../../ui';
import { alcanza, useClubActual } from '../sesion';

interface EstadoMp {
  configurado: boolean;
  conWebhookSecret: boolean;
  urlWebhook: string;
}

export function Cobros() {
  return (
    <>
      <MercadoPago />
      <DatosTransferencia />
    </>
  );
}

function MercadoPago() {
  const { clubId, rol } = useClubActual();
  const qc = useQueryClient();
  const esDueno = alcanza(rol, 'OWNER');
  const [token, setToken] = useState('');
  const [secreto, setSecreto] = useState('');
  const estado = useQuery({
    queryKey: ['mp', clubId],
    queryFn: () => panel.get<EstadoMp>(`/clubs/${clubId}/mercadopago`),
  });
  const guardar = useMutation({
    mutationFn: () =>
      panel.put<{ cuenta: { nickname: string } }>(`/clubs/${clubId}/mercadopago`, {
        accessToken: token.trim(),
        ...(secreto.trim() ? { webhookSecret: secreto.trim() } : {}),
      }),
    onSuccess: () => {
      setToken('');
      setSecreto('');
      qc.invalidateQueries({ queryKey: ['mp', clubId] });
    },
  });
  const quitar = useMutation({
    mutationFn: () => panel.borrar(`/clubs/${clubId}/mercadopago`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mp', clubId] }),
  });

  return (
    <Tarjeta className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">Mercado Pago</h2>
      {estado.isPending ? (
        <Cargando />
      ) : estado.isError ? (
        <Aviso>{estado.error.message}</Aviso>
      ) : (
        <>
          <p className="text-sm">
            {estado.data.configurado ? (
              <>
                <strong className="text-cancha-oscuro">Conectado.</strong> Los clientes pueden pagar la seña
                con Mercado Pago.
                {!estado.data.conWebhookSecret ? ' Falta cargar la clave secreta de webhooks.' : ''}
              </>
            ) : (
              'Sin conectar: los clientes solo pueden pagar por transferencia.'
            )}
          </p>
          <div className="rounded-xs bg-fondo px-4 py-3 text-sm">
            <div className="font-semibold">
              URL de notificaciones (cargala en Mercado Pago → Webhooks → Pagos):
            </div>
            <code className="break-all text-sm">{estado.data.urlWebhook}</code>
          </div>
          {guardar.data ? (
            <Aviso tipo="ok">Listo: cuenta {guardar.data.cuenta.nickname} conectada.</Aviso>
          ) : null}
          {esDueno ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                guardar.mutate();
              }}
            >
              <Campo
                etiqueta="Access token de producción"
                type="password"
                autoComplete="off"
                placeholder="APP_USR-…"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                ayuda="Lo validamos con Mercado Pago y lo guardamos cifrado. Nunca se vuelve a mostrar."
              />
              <Campo
                etiqueta="Clave secreta de webhooks (opcional)"
                type="password"
                autoComplete="off"
                value={secreto}
                onChange={(e) => setSecreto(e.target.value)}
              />
              {guardar.error ? <Aviso>{mensajeDe(guardar.error)}</Aviso> : null}
              <div className="flex flex-wrap gap-2">
                <Boton type="submit" disabled={guardar.isPending}>
                  {guardar.isPending
                    ? 'Validando…'
                    : estado.data.configurado
                      ? 'Reemplazar credenciales'
                      : 'Conectar Mercado Pago'}
                </Boton>
                {estado.data.configurado ? (
                  <Boton variante="peligro" disabled={quitar.isPending} onClick={() => quitar.mutate()}>
                    Desconectar
                  </Boton>
                ) : null}
              </div>
            </form>
          ) : (
            <p className="text-sm text-suave">Solo el dueño del club puede cambiar las credenciales.</p>
          )}
        </>
      )}
    </Tarjeta>
  );
}

function DatosTransferencia() {
  const { clubId, club } = useClubActual();
  const qc = useQueryClient();
  const publico = useQuery({
    queryKey: ['club', club?.slug],
    queryFn: () => pedir<ClubPublico>(`/public/clubs/${club?.slug}`),
    enabled: Boolean(club?.slug),
  });
  const actuales = publico.data?.mediosPago.transferencia;
  const [f, setF] = useState<{ alias: string; cbu: string; titular: string } | null>(null);
  const valores = f ?? {
    alias: actuales?.alias ?? '',
    cbu: actuales?.cbu ?? '',
    titular: actuales?.titular ?? '',
  };
  const guardar = useMutation({
    mutationFn: () =>
      panel.put(`/clubs/${clubId}/transferencia`, {
        titular: valores.titular.trim(),
        ...(valores.alias.trim() ? { alias: valores.alias.trim() } : {}),
        ...(valores.cbu.trim() ? { cbu: valores.cbu.trim() } : {}),
      }),
    onSuccess: () => {
      setF(null);
      qc.invalidateQueries({ queryKey: ['club', club?.slug] });
    },
  });
  const quitar = useMutation({
    mutationFn: () => panel.borrar(`/clubs/${clubId}/transferencia`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['club', club?.slug] }),
  });

  return (
    <Tarjeta className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">Transferencia</h2>
      <p className="text-sm text-suave">
        Se muestran al cliente para que pague la seña y suba el comprobante.
      </p>
      {publico.isPending ? (
        <Cargando />
      ) : (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            guardar.mutate();
          }}
        >
          <Campo
            etiqueta="Alias"
            value={valores.alias}
            onChange={(e) => setF({ ...valores, alias: e.target.value })}
          />
          <Campo
            etiqueta="CBU / CVU"
            inputMode="numeric"
            value={valores.cbu}
            onChange={(e) => setF({ ...valores, cbu: e.target.value })}
          />
          <div className="sm:col-span-2">
            <Campo
              etiqueta="Titular"
              value={valores.titular}
              onChange={(e) => setF({ ...valores, titular: e.target.value })}
              required
            />
          </div>
          {guardar.error || quitar.error ? (
            <div className="sm:col-span-2">
              <Aviso>{mensajeDe(guardar.error ?? quitar.error)}</Aviso>
            </div>
          ) : null}
          {guardar.isSuccess && !f ? (
            <div className="sm:col-span-2">
              <Aviso tipo="ok">Guardado.</Aviso>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Boton type="submit" disabled={guardar.isPending}>
              Guardar
            </Boton>
            {actuales ? (
              <Boton variante="peligro" disabled={quitar.isPending} onClick={() => quitar.mutate()}>
                No aceptar transferencias
              </Boton>
            ) : null}
          </div>
        </form>
      )}
    </Tarjeta>
  );
}
