'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { panel } from '@/lib/api';
import { iniciales } from '@/lib/formato';
import type { Rol, Transferencia } from '@/lib/tipos';
import { alcanza, useClubActual, useSesion } from './sesion';

const SECCIONES: { ruta: string; nombre: string; rol: Rol }[] = [
  { ruta: 'agenda', nombre: 'Agenda', rol: 'RECEPCION' },
  { ruta: 'checkin', nombre: 'Check-in', rol: 'RECEPCION' },
  { ruta: 'transferencias', nombre: 'Transferencias', rol: 'RECEPCION' },
  { ruta: 'reembolsos', nombre: 'Reembolsos', rol: 'RECEPCION' },
  { ruta: 'configuracion', nombre: 'Configuración', rol: 'ADMIN' },
];

const ROLES: Record<Rol, string> = { OWNER: 'Dueño', ADMIN: 'Administración', RECEPCION: 'Recepción' };

export function BarraLateral() {
  const { clubId, club, rol } = useClubActual();
  const sesion = useSesion();
  const ruta = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const pendientes = useQuery({
    queryKey: ['transferencias', clubId, 'EN_REVISION'],
    queryFn: () => panel.get<Transferencia[]>(`/clubs/${clubId}/transferencias`),
    refetchInterval: 60_000,
  });
  const salir = useMutation({
    mutationFn: () => panel.post('/auth/logout'),
    onSettled: () => {
      qc.clear();
      router.replace('/panel/login');
    },
  });

  return (
    <nav
      aria-label="Secciones del panel"
      className="flex w-full flex-col gap-1 bg-noche px-3.5 py-5 text-white lg:w-60 lg:flex-none"
    >
      <div className="flex items-center gap-2.5 px-1.5 pb-4">
        <div className="flex size-9 items-center justify-center rounded-xl bg-cancha font-display text-lg font-bold">
          {club ? iniciales(club.nombre) : ''}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold">{club?.nombre ?? '—'}</div>
          <div className="text-xs text-[#aab7af]">
            {sesion.data?.usuario.nombre} · {rol ? ROLES[rol] : ''}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 lg:flex-col">
        {SECCIONES.filter((s) => alcanza(rol, s.rol)).map((s) => {
          const href = `/panel/${clubId}/${s.ruta}`;
          const actual = ruta.startsWith(href);
          const badge = s.ruta === 'transferencias' ? (pendientes.data?.length ?? 0) : 0;
          return (
            <Link
              key={s.ruta}
              href={href}
              aria-current={actual ? 'page' : undefined}
              className={`flex min-h-11 items-center justify-between gap-2 rounded-xl px-3 text-sm font-semibold ${
                actual ? 'bg-noche-2 text-white' : 'text-[#c9d3cc] hover:bg-noche-2 hover:text-white'
              }`}
            >
              {s.nombre}
              {badge > 0 ? (
                <span className="inline-flex h-5.5 min-w-5.5 items-center justify-center rounded-full bg-[#e8b04b] px-1.5 text-xs font-bold text-[#2a1a00]">
                  {badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
      {(sesion.data?.clubs.length ?? 0) > 1 ? (
        <label className="mt-4 flex flex-col gap-1 px-1.5 text-xs text-[#aab7af]">
          Club
          <select
            value={clubId}
            onChange={(e) => router.push(`/panel/${e.target.value}/agenda`)}
            className="min-h-10 rounded-lg bg-noche-2 px-2 text-sm text-white"
          >
            {sesion.data?.clubs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button
        type="button"
        onClick={() => salir.mutate()}
        className="mt-auto min-h-11 rounded-xl px-3 text-left text-sm font-semibold text-[#c9d3cc] hover:bg-noche-2 hover:text-white"
      >
        Cerrar sesión
      </button>
    </nav>
  );
}
