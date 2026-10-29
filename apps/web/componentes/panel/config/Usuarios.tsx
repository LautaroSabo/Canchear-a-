'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { mensajeDe, panel } from '@/lib/api';
import type { Rol, UsuarioClub } from '@/lib/tipos';
import { Aviso, Boton, Campo, Cargando, Selector, Tarjeta } from '../../ui';
import { useClubActual, useSesion } from '../sesion';
import { useGuardar } from './comunes';

const ROLES: Record<Rol, { nombre: string; detalle: string }> = {
  RECEPCION: { nombre: 'Recepción', detalle: 'agenda, check-in, cobros y transferencias' },
  ADMIN: { nombre: 'Administración', detalle: 'además, configura canchas, precios y horarios' },
  OWNER: { nombre: 'Dueño', detalle: 'además, maneja usuarios y la cuenta de Mercado Pago' },
};

export function Usuarios() {
  const { clubId } = useClubActual();
  const yo = useSesion().data?.usuario.id;
  const lista = useQuery({
    queryKey: ['usuarios', clubId],
    queryFn: () => panel.get<UsuarioClub[]>(`/clubs/${clubId}/config/usuarios`),
  });
  const vacio = { email: '', nombre: '', rol: 'RECEPCION' as Rol };
  const [f, setF] = useState(vacio);
  const [creado, setCreado] = useState<{ email: string; contrasena: string | null } | null>(null);
  const invitar = useGuardar(
    (id) => panel.post<{ contrasenaGenerada: string | null }>(`/clubs/${id}/config/usuarios`, f),
    (r) => {
      setCreado({ email: f.email.trim().toLowerCase(), contrasena: r.contrasenaGenerada });
      setF(vacio);
    },
  );
  const cambiarRol = useGuardar((id, a: { usuarioId: string; rol: Rol }) =>
    panel.patch(`/clubs/${id}/config/usuarios/${a.usuarioId}`, { rol: a.rol }),
  );
  const quitar = useGuardar((id, usuarioId: string) =>
    panel.borrar(`/clubs/${id}/config/usuarios/${usuarioId}`),
  );
  const error = cambiarRol.error ?? quitar.error;

  return (
    <Tarjeta className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">Usuarios del panel</h2>
      <ul className="text-sm text-suave">
        {Object.values(ROLES).map((r) => (
          <li key={r.nombre}>
            <strong className="text-medio">{r.nombre}:</strong> {r.detalle}.
          </li>
        ))}
      </ul>
      {error ? <Aviso>{mensajeDe(error)}</Aviso> : null}
      {lista.isPending ? (
        <Cargando />
      ) : lista.isError ? (
        <Aviso>{lista.error.message}</Aviso>
      ) : (
        <ul className="flex flex-col divide-y divide-linea">
          {lista.data.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <div className="font-bold">
                  {u.nombre}
                  {u.id === yo ? <span className="font-normal text-suave"> (vos)</span> : null}
                </div>
                <div className="truncate text-sm text-medio">{u.email}</div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label={`Rol de ${u.nombre}`}
                  value={u.rol}
                  disabled={cambiarRol.isPending}
                  onChange={(e) => cambiarRol.mutate({ usuarioId: u.id, rol: e.target.value as Rol })}
                  className="min-h-11 rounded-xs border border-borde-control bg-superficie px-2 text-sm"
                >
                  {Object.entries(ROLES).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r.nombre}
                    </option>
                  ))}
                </select>
                {u.id === yo ? null : (
                  <Boton variante="fantasma" disabled={quitar.isPending} onClick={() => quitar.mutate(u.id)}>
                    Quitar
                  </Boton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {creado ? (
        <Aviso tipo="ok">
          {creado.contrasena ? (
            <>
              Listo. Pasale estos datos a la persona (la contraseña no se vuelve a mostrar; la puede cambiar
              desde “Mi cuenta”):
              <br />
              Email: <strong>{creado.email}</strong> · Contraseña:{' '}
              <code className="font-bold">{creado.contrasena}</code>
            </>
          ) : (
            <>Listo: {creado.email} ya tenía cuenta y ahora también puede entrar a este club.</>
          )}
        </Aviso>
      ) : null}
      <form
        className="grid gap-3 rounded-xs bg-fondo p-4 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          setCreado(null);
          invitar.mutate();
        }}
      >
        <h3 className="font-bold sm:col-span-3">Sumar a alguien</h3>
        <Campo
          etiqueta="Nombre"
          value={f.nombre}
          maxLength={80}
          onChange={(e) => setF({ ...f, nombre: e.target.value })}
          required
        />
        <Campo
          etiqueta="Email"
          type="email"
          value={f.email}
          onChange={(e) => setF({ ...f, email: e.target.value })}
          required
        />
        <Selector etiqueta="Rol" value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value as Rol })}>
          {Object.entries(ROLES).map(([v, r]) => (
            <option key={v} value={v}>
              {r.nombre}
            </option>
          ))}
        </Selector>
        {invitar.error ? (
          <div className="sm:col-span-3">
            <Aviso>{mensajeDe(invitar.error)}</Aviso>
          </div>
        ) : null}
        <div className="sm:col-span-3">
          <Boton type="submit" disabled={invitar.isPending}>
            Sumar al club
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}
