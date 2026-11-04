'use client';

import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { mensajeDe, panel } from '@/lib/api';
import { Aviso, Boton, BotonLink, Campo } from '../ui';
import { MarcoAcceso } from './MarcoAcceso';

const LARGO = 10;

export function Restablecer() {
  const token = useSearchParams().get('token') ?? '';
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState<{ nueva?: string; repetida?: string }>({});
  const guardar = useMutation({ mutationFn: () => panel.post('/auth/restablecer', { token, nueva }) });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const err = {
      ...(nueva.length < LARGO ? { nueva: `Usá al menos ${LARGO} caracteres.` } : {}),
      ...(repetida !== nueva ? { repetida: 'Las dos contraseñas no coinciden.' } : {}),
    };
    setError(err);
    if (!err.nueva && !err.repetida) guardar.mutate();
  };

  return (
    <MarcoAcceso
      titulo="Elegí tu contraseña"
      bajada="Después vas a entrar al panel con tu email y esta contraseña."
    >
      {!token ? (
        <Aviso>Este link está incompleto. Pedí uno nuevo desde "¿Olvidaste tu contraseña?".</Aviso>
      ) : guardar.isSuccess ? (
        <>
          <Aviso tipo="ok">Listo, tu contraseña cambió. Por seguridad cerramos las sesiones abiertas.</Aviso>
          <BotonLink href="/panel/login" grande>
            Entrar al panel
          </BotonLink>
        </>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={enviar} noValidate>
          <Campo
            etiqueta="Contraseña nueva"
            type="password"
            autoComplete="new-password"
            ayuda={`Al menos ${LARGO} caracteres.`}
            value={nueva}
            error={error.nueva}
            onChange={(e) => setNueva(e.target.value)}
          />
          <Campo
            etiqueta="Repetila"
            type="password"
            autoComplete="new-password"
            value={repetida}
            error={error.repetida}
            onChange={(e) => setRepetida(e.target.value)}
          />
          {guardar.error ? <Aviso>{mensajeDe(guardar.error)}</Aviso> : null}
          <Boton type="submit" grande disabled={guardar.isPending}>
            {guardar.isPending ? 'Guardando…' : 'Guardar contraseña'}
          </Boton>
        </form>
      )}
    </MarcoAcceso>
  );
}
