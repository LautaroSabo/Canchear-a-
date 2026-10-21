'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Aviso, Boton, Campo } from '@/componentes/ui';
import { mensajeDe, panel } from '@/lib/api';
import type { Sesion } from '@/lib/tipos';

export default function Login() {
  const router = useRouter();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [contrasena, setContrasena] = useState('');
  const login = useMutation({
    mutationFn: () => panel.post<Sesion>('/auth/login', { email, contrasena }),
    onSuccess: (sesion) => {
      qc.setQueryData(['sesion'], sesion);
      router.replace('/panel');
    },
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-noche px-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-white p-6"
      >
        <div>
          <h1 className="font-display text-4xl font-bold">Panel del club</h1>
          <p className="mt-1 text-sm text-suave">Ingresá con el usuario que te dio el club.</p>
        </div>
        <Campo
          etiqueta="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Campo
          etiqueta="Contraseña"
          type="password"
          autoComplete="current-password"
          value={contrasena}
          onChange={(e) => setContrasena(e.target.value)}
          required
        />
        {login.error ? <Aviso>{mensajeDe(login.error)}</Aviso> : null}
        <Boton type="submit" grande disabled={login.isPending}>
          {login.isPending ? 'Entrando…' : 'Entrar'}
        </Boton>
      </form>
    </main>
  );
}
