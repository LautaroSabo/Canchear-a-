'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ErrorApi, panel } from '@/lib/api';
import type { Rol, Sesion } from '@/lib/tipos';
import { Cargando } from '../ui';

export function useSesion() {
  return useQuery({
    queryKey: ['sesion'],
    queryFn: () => panel.get<Sesion>('/auth/yo'),
    retry: (n, e) => !(e instanceof ErrorApi && e.status === 401) && n < 2,
    staleTime: 60_000,
  });
}

/** Club de la URL dentro de la sesión (con el rol del usuario en él). */
export function useClubActual() {
  const { clubId } = useParams<{ clubId: string }>();
  const sesion = useSesion();
  const club = sesion.data?.clubs.find((c) => c.id === clubId);
  // Todas las horas del panel se muestran en la zona del club, no en la del navegador.
  const zona = club?.zonaHoraria ?? 'America/Argentina/Buenos_Aires';
  return { clubId, club, rol: club?.rol, zona };
}

const JERARQUIA: Record<Rol, number> = { RECEPCION: 1, ADMIN: 2, OWNER: 3 };
export const alcanza = (rol: Rol | undefined, minimo: Rol) =>
  Boolean(rol) && JERARQUIA[rol as Rol] >= JERARQUIA[minimo];

/** Sin sesión → al login. Mientras tanto no muestra nada del panel. */
export function GuardSesion({ children }: { children: React.ReactNode }) {
  const sesion = useSesion();
  const router = useRouter();
  const sinSesion = sesion.error instanceof ErrorApi && sesion.error.status === 401;
  useEffect(() => {
    if (sinSesion) router.replace('/panel/login');
  }, [sinSesion, router]);
  if (sesion.isPending || sinSesion) return <Cargando texto="Verificando tu sesión…" />;
  if (sesion.isError) return <p className="p-6 text-[#7a1a0c]">{sesion.error.message}</p>;
  return children;
}
