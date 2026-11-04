import Link from 'next/link';
import type { ReactNode } from 'react';
import { LineasCancha } from '../publico/LineasCancha';

/** Fondo de las pantallas de acceso al panel (contraseña olvidada, contraseña nueva). */
export function MarcoAcceso({
  titulo,
  bajada,
  children,
}: {
  titulo: string;
  bajada: string;
  children: ReactNode;
}) {
  return (
    <div className="tema-noche relative flex min-h-screen items-center overflow-hidden bg-fondo text-tinta">
      <LineasCancha className="text-cal opacity-[0.07]" />
      <main className="relative mx-auto grid w-full max-w-5xl items-center gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1fr_400px]">
        <div>
          <h1 className="font-display text-[48px] leading-[0.9] font-extrabold uppercase sm:text-[64px]">
            {titulo}
          </h1>
          <p className="mt-4 max-w-sm text-lg text-tenue">{bajada}</p>
          <p className="mt-6 text-base text-tenue">
            <Link href="/panel/login" className="font-semibold text-tinta underline">
              Volver a entrar
            </Link>
          </p>
        </div>
        <div className="flex w-full flex-col gap-4 border border-linea bg-superficie p-6">{children}</div>
      </main>
    </div>
  );
}
