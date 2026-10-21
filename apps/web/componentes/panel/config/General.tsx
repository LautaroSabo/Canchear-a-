'use client';

import { useState } from 'react';
import { mensajeDe, panel } from '@/lib/api';
import type { ConfigClub } from '@/lib/tipos';
import { Aviso, Boton, Campo, Tarjeta } from '../../ui';
import { useGuardar } from './comunes';

export function General({ club }: { club: ConfigClub['club'] }) {
  const inicial = {
    nombre: club.nombre,
    telefono: club.telefono ?? '',
    direccion: club.direccion ?? '',
    minutos: String(club.minutosRevisionTransferencia),
  };
  const [f, setF] = useState(inicial);
  const guardar = useGuardar((clubId) =>
    panel.patch(`/clubs/${clubId}/config/club`, {
      nombre: f.nombre.trim(),
      telefono: f.telefono.trim() || null,
      direccion: f.direccion.trim() || null,
      minutosRevisionTransferencia: Number(f.minutos),
    }),
  );
  const cambiado = JSON.stringify(f) !== JSON.stringify(inicial);

  return (
    <Tarjeta>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          guardar.mutate();
        }}
      >
        <h2 className="text-lg font-bold sm:col-span-2">Datos del club</h2>
        <Campo
          etiqueta="Nombre"
          value={f.nombre}
          onChange={(e) => setF({ ...f, nombre: e.target.value })}
          required
          maxLength={120}
        />
        <Campo
          etiqueta="Teléfono / WhatsApp"
          type="tel"
          placeholder="+54 9 11 1234-5678"
          value={f.telefono}
          onChange={(e) => setF({ ...f, telefono: e.target.value })}
          ayuda="Se muestra en la página de reservas para consultas."
        />
        <div className="sm:col-span-2">
          <Campo
            etiqueta="Dirección"
            value={f.direccion}
            onChange={(e) => setF({ ...f, direccion: e.target.value })}
            maxLength={200}
          />
        </div>
        <Campo
          etiqueta="Minutos para revisar una transferencia"
          type="number"
          min={5}
          max={1440}
          value={f.minutos}
          onChange={(e) => setF({ ...f, minutos: e.target.value })}
          ayuda="Cuando el cliente sube el comprobante, el turno queda reservado este tiempo extra mientras lo revisás."
        />
        <div className="text-sm text-suave sm:self-end sm:pb-3">
          Link público: <code className="text-tinta">/{club.slug}</code>
        </div>
        {guardar.error ? (
          <div className="sm:col-span-2">
            <Aviso>{mensajeDe(guardar.error)}</Aviso>
          </div>
        ) : null}
        {guardar.isSuccess && !cambiado ? (
          <div className="sm:col-span-2">
            <Aviso tipo="ok">Guardado.</Aviso>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <Boton type="submit" disabled={guardar.isPending || !cambiado}>
            Guardar
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}
