'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LineasCancha } from '@/componentes/publico/LineasCancha';
import { Aviso, Boton, Campo } from '@/componentes/ui';
import { ErrorApi, mensajeDe, panel } from '@/lib/api';
import type { Sesion } from '@/lib/tipos';

export default function Login() {
  const router = useRouter();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [contrasena, setContrasena] = useState('');
  // Con verificación en dos pasos, la contraseña devuelve un desafío y falta el código.
  const [desafio, setDesafio] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const entrar = (sesion: Sesion) => {
    qc.setQueryData(['sesion'], sesion);
    router.replace('/panel');
  };
  const login = useMutation({
    mutationFn: () =>
      panel.post<Sesion | { dosPasos: true; desafio: string }>('/auth/login', { email, contrasena }),
    onSuccess: (r) => ('dosPasos' in r ? setDesafio(r.desafio) : entrar(r)),
  });
  const segundoPaso = useMutation({
    mutationFn: () => panel.post<Sesion>('/auth/login/dos-pasos', { desafio, codigo }),
    onSuccess: entrar,
    onError: (e) => {
      // Se venció o se agotaron los intentos: vuelve a pedir la contraseña.
      if (e instanceof ErrorApi && e.codigo === 'DESAFIO_VENCIDO') {
        setDesafio(null);
        setCodigo('');
      }
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
          <p className="mt-4 max-w-sm text-lg text-tenue">Ingresá con tu email y tu contraseña.</p>
          <p className="mt-6 text-base text-tenue">
            ¿Tenés un club y todavía no usás Canchería?{' '}
            <Link href="/registrar" className="font-semibold text-tinta underline">
              Registralo
            </Link>
          </p>
        </div>
        {desafio ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              segundoPaso.mutate();
            }}
            className="flex w-full flex-col gap-4 border border-linea bg-superficie p-6"
          >
            <h2 className="text-lg font-bold">Verificación en dos pasos</h2>
            <p className="text-sm text-tenue">
              Abrí la app autenticadora del celular y escribí el código de 6 números de Canchería.
            </p>
            <Campo
              etiqueta="Código"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              ayuda="¿Perdiste el celular? Escribí uno de tus códigos de recuperación (por ejemplo K7QM-2XPV)."
              required
            />
            {segundoPaso.error ? <Aviso>{mensajeDe(segundoPaso.error)}</Aviso> : null}
            <Boton type="submit" grande disabled={segundoPaso.isPending || codigo.trim().length < 6}>
              {segundoPaso.isPending ? 'Verificando…' : 'Entrar'}
            </Boton>
            <button
              type="button"
              onClick={() => {
                setDesafio(null);
                setCodigo('');
              }}
              className="self-center text-sm font-semibold text-tenue underline hover:text-tinta"
            >
              Volver
            </button>
          </form>
        ) : (
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
            <Link
              href="/panel/olvide"
              className="self-center text-sm font-semibold text-tenue underline hover:text-tinta"
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </form>
        )}
      </main>
    </div>
  );
}
