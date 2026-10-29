'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LineasCancha } from '@/componentes/publico/LineasCancha';
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
    <div className="tema-noche relative flex min-h-screen items-center overflow-hidden bg-fondo text-tinta">
      <LineasCancha className="text-cal opacity-[0.07]" />
      <main className="relative mx-auto grid w-full max-w-5xl items-center gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1fr_400px]">
        <div>
          <h1 className="font-display text-[56px] leading-[0.9] font-extrabold uppercase sm:text-[72px]">
            Canchería · panel del club
          </h1>
          <p className="mt-4 max-w-sm text-lg text-tenue">Ingresá con el usuario que te dio el club.</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate();
          }}
          className="flex w-full flex-col gap-4 border border-linea bg-superficie p-6"
        >
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
    </div>
  );
}
