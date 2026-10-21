'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { mensajeDe, panel } from '@/lib/api';
import { Aviso, Boton, Campo, Tarjeta } from '../ui';
import { useSesion } from './sesion';

export function Cuenta() {
  const usuario = useSesion().data?.usuario;
  const vacio = { actual: '', nueva: '', repetida: '' };
  const [f, setF] = useState(vacio);
  const cambiar = useMutation({
    mutationFn: () => panel.post('/auth/contrasena', { actual: f.actual, nueva: f.nueva }),
    onSuccess: () => setF(vacio),
  });
  const distintas = f.repetida !== '' && f.nueva !== f.repetida;

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="font-display text-[30px] font-bold">Mi cuenta</h1>
      <Tarjeta>
        <div className="font-bold">{usuario?.nombre}</div>
        <div className="text-sm text-medio">{usuario?.email}</div>
      </Tarjeta>
      <Tarjeta>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!distintas) cambiar.mutate();
          }}
        >
          <h2 className="text-lg font-bold">Cambiar contraseña</h2>
          <Campo
            etiqueta="Contraseña actual"
            type="password"
            autoComplete="current-password"
            value={f.actual}
            onChange={(e) => setF({ ...f, actual: e.target.value })}
            required
          />
          <Campo
            etiqueta="Contraseña nueva"
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={f.nueva}
            onChange={(e) => setF({ ...f, nueva: e.target.value })}
            required
            ayuda="Al menos 10 caracteres."
          />
          <Campo
            etiqueta="Repetí la contraseña nueva"
            type="password"
            autoComplete="new-password"
            value={f.repetida}
            onChange={(e) => setF({ ...f, repetida: e.target.value })}
            required
          />
          {distintas ? <Aviso>Las contraseñas nuevas no coinciden.</Aviso> : null}
          {cambiar.error ? <Aviso>{mensajeDe(cambiar.error)}</Aviso> : null}
          {cambiar.isSuccess ? (
            <Aviso tipo="ok">Listo. Cerramos tus otras sesiones abiertas en otros dispositivos.</Aviso>
          ) : null}
          <Boton type="submit" disabled={cambiar.isPending}>
            Cambiar contraseña
          </Boton>
        </form>
      </Tarjeta>
    </div>
  );
}
