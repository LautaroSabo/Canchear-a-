'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { panel } from '@/lib/api';
import type { Rol, Transferencia } from '@/lib/tipos';
import { IconoCerrar } from '../iconos';
import { alcanza, useClubActual, useSesion } from './sesion';

type Seccion = { ruta: string; nombre: string; corto?: string; rol: Rol };

// Agrupadas por para qué se usan en el día: lo de la recepción arriba, lo del dueño abajo.
const GRUPOS: { nombre: string; secciones: Seccion[] }[] = [
  {
    nombre: 'Hoy',
    secciones: [
      { ruta: 'agenda', nombre: 'Agenda', rol: 'RECEPCION' },
      { ruta: 'checkin', nombre: 'Check-in', rol: 'RECEPCION' },
      { ruta: 'turnos-fijos', nombre: 'Turnos fijos', corto: 'Fijos', rol: 'RECEPCION' },
      { ruta: 'cantina', nombre: 'Cantina', rol: 'RECEPCION' },
    ],
  },
  {
    nombre: 'Plata',
    secciones: [
      { ruta: 'transferencias', nombre: 'Transferencias', corto: 'Cobros', rol: 'RECEPCION' },
      { ruta: 'reembolsos', nombre: 'Reembolsos', rol: 'RECEPCION' },
    ],
  },
  {
    nombre: 'Gente',
    secciones: [
      { ruta: 'clientes', nombre: 'Clientes y puntos', corto: 'Clientes', rol: 'RECEPCION' },
      { ruta: 'mensajes', nombre: 'Mensajes', rol: 'RECEPCION' },
    ],
  },
  {
    nombre: 'Club',
    secciones: [
      { ruta: 'reportes', nombre: 'Reportes', rol: 'ADMIN' },
      { ruta: 'configuracion', nombre: 'Configuración', rol: 'ADMIN' },
      { ruta: 'cuenta', nombre: 'Mi cuenta', rol: 'RECEPCION' },
    ],
  },
];

// En el celular, abajo van las cuatro que se usan con el teléfono en la mano.
const ABAJO = ['agenda', 'checkin', 'cantina', 'transferencias'];

const ROLES: Record<Rol, string> = { OWNER: 'Dueño', ADMIN: 'Administración', RECEPCION: 'Recepción' };

function useNavegacion() {
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
  const omitidos = useQuery({
    queryKey: ['turnos-fijos', clubId, 'pendientes'],
    queryFn: () => panel.get<{ omitidos: number }>(`/clubs/${clubId}/turnos-fijos/pendientes`),
    refetchInterval: 5 * 60_000,
  });
  const salir = useMutation({
    mutationFn: () => panel.post('/auth/logout'),
    onSettled: () => {
      qc.clear();
      router.replace('/panel/login');
    },
  });
  const grupos = GRUPOS.map((g) => ({
    ...g,
    secciones: g.secciones.filter((s) => alcanza(rol, s.rol)),
  })).filter((g) => g.secciones.length > 0);
  const badge = (s: string) =>
    s === 'transferencias'
      ? (pendientes.data?.length ?? 0)
      : s === 'turnos-fijos'
        ? (omitidos.data?.omitidos ?? 0)
        : 0;
  const href = (s: string) => `/panel/${clubId}/${s}`;
  const actual = (s: string) => ruta.startsWith(href(s));
  return { clubId, club, rol, sesion, router, grupos, badge, href, actual, salir };
}

function Contador({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-xs bg-[#f2b441] px-1.5 text-sm font-bold text-noche">
      {n}
    </span>
  );
}

function ListaSecciones({ nav, alElegir }: { nav: ReturnType<typeof useNavegacion>; alElegir?: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      {nav.grupos.map((g) => (
        <div key={g.nombre}>
          <p className="px-3 pb-1 text-sm text-[#a8b8ad]">{g.nombre}</p>
          <ul className="flex flex-col">
            {g.secciones.map((s) => {
              const actual = nav.actual(s.ruta);
              return (
                <li key={s.ruta}>
                  <Link
                    href={nav.href(s.ruta)}
                    onClick={alElegir}
                    aria-current={actual ? 'page' : undefined}
                    className={`flex min-h-11 items-center justify-between gap-2 border-l-[3px] px-3 text-[15px] font-semibold ${
                      actual
                        ? 'border-[#46ad65] bg-noche-2 text-cal'
                        : 'border-transparent text-[#c9d5cc] hover:bg-noche-2 hover:text-cal'
                    }`}
                  >
                    {s.nombre}
                    <Contador n={nav.badge(s.ruta)} />
                    {nav.badge(s.ruta) > 0 ? <span className="sr-only"> pendientes</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function PieCuenta({ nav }: { nav: ReturnType<typeof useNavegacion> }) {
  return (
    <div className="flex flex-col gap-2 border-t border-[#2a3f33] pt-4">
      {(nav.sesion.data?.clubs.length ?? 0) > 1 ? (
        <label className="flex flex-col gap-1 px-3 text-sm text-[#a8b8ad]">
          Club
          <select
            value={nav.clubId}
            onChange={(e) => nav.router.push(`/panel/${e.target.value}/agenda`)}
            className="min-h-11 rounded-xs border border-borde-control bg-noche-2 px-2 text-base text-cal"
          >
            {nav.sesion.data?.clubs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p className="px-3 text-sm text-[#a8b8ad]">
        {nav.sesion.data?.usuario.nombre} · {nav.rol ? ROLES[nav.rol] : ''}
      </p>
      <button
        type="button"
        onClick={() => nav.salir.mutate()}
        className="min-h-11 px-3 text-left text-[15px] font-semibold text-[#c9d5cc] hover:bg-noche-2 hover:text-cal"
      >
        Cerrar sesión
      </button>
    </div>
  );
}

/** Escritorio: riel fijo, de noche como el lado público. */
export function BarraLateral() {
  const nav = useNavegacion();
  return (
    <nav
      aria-label="Secciones del panel"
      className="tema-noche sticky top-0 hidden h-screen w-60 flex-none flex-col gap-6 overflow-y-auto bg-noche py-5 lg:flex"
    >
      <Link
        href={nav.href('agenda')}
        className="block px-4 font-display text-[26px] leading-none font-extrabold text-cal uppercase"
      >
        {nav.club?.nombre ?? '—'}
      </Link>
      <ListaSecciones nav={nav} />
      <div className="mt-auto">
        <PieCuenta nav={nav} />
      </div>
    </nav>
  );
}

/** Celular y tablet: barra de arriba con el club, y abajo las cuatro secciones de todos los días + "Más". */
export function NavegacionMovil() {
  const nav = useNavegacion();
  const [abierto, setAbierto] = useState(false);
  const refMas = useRef<HTMLButtonElement>(null);
  const yaAbrio = useRef(false);
  useEffect(() => {
    if (abierto) yaAbrio.current = true;
    else if (yaAbrio.current) refMas.current?.focus();
  }, [abierto]);
  const rutaActual = usePathname();
  // biome-ignore lint/correctness/useExhaustiveDependencies: cerrar el menú al navegar.
  useEffect(() => setAbierto(false), [rutaActual]);
  useEffect(() => {
    if (!abierto) return;
    const cerrar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false);
    };
    window.addEventListener('keydown', cerrar);
    return () => window.removeEventListener('keydown', cerrar);
  }, [abierto]);

  const abajo = nav.grupos.flatMap((g) => g.secciones).filter((s) => ABAJO.includes(s.ruta));
  const masActivo = !abajo.some((s) => nav.actual(s.ruta));

  return (
    <>
      <header className="tema-noche sticky top-0 z-20 flex min-h-14 items-center bg-noche px-4 lg:hidden">
        <span className="truncate font-display text-2xl font-extrabold text-cal uppercase">
          {nav.club?.nombre ?? '—'}
        </span>
      </header>

      <nav
        aria-label="Secciones principales"
        className="tema-noche fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-[#2a3f33] bg-noche pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {abajo.map((s) => {
          const actual = nav.actual(s.ruta);
          const n = nav.badge(s.ruta);
          return (
            <Link
              key={s.ruta}
              href={nav.href(s.ruta)}
              aria-current={actual ? 'page' : undefined}
              aria-label={n > 0 ? `${s.nombre} (${n} pendientes)` : s.nombre}
              className={`relative flex min-h-15 flex-col items-center justify-center border-t-[3px] text-sm font-semibold ${
                actual ? 'border-[#46ad65] text-cal' : 'border-transparent text-[#c9d5cc]'
              }`}
            >
              {s.corto ?? s.nombre}
              {n > 0 ? (
                <span className="absolute top-1.5 right-2 inline-flex h-5 min-w-5 items-center justify-center rounded-xs bg-[#f2b441] px-1 text-xs font-bold text-noche">
                  {n}
                </span>
              ) : null}
            </Link>
          );
        })}
        <button
          type="button"
          ref={refMas}
          aria-expanded={abierto}
          aria-haspopup="dialog"
          onClick={() => setAbierto(true)}
          className={`flex min-h-15 flex-col items-center justify-center border-t-[3px] text-sm font-semibold ${
            masActivo ? 'border-[#46ad65] text-cal' : 'border-transparent text-[#c9d5cc]'
          }`}
        >
          Más
        </button>
      </nav>

      {abierto ? (
        <div className="tema-noche fixed inset-0 z-30 lg:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => setAbierto(false)}
            className="absolute inset-0 bg-black/60"
          />
          <div
            id="menu-mas"
            role="dialog"
            aria-modal="true"
            aria-label="Todas las secciones"
            className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col gap-5 overflow-y-auto bg-noche px-2 pt-3 pb-[calc(env(safe-area-inset-bottom)+16px)]"
          >
            <div className="flex items-center justify-between px-3">
              <span className="font-display text-2xl font-bold text-cal uppercase">Secciones</span>
              <button
                type="button"
                // biome-ignore lint/a11y/noAutofocus: al abrir el menú el foco entra al diálogo.
                autoFocus
                onClick={() => setAbierto(false)}
                aria-label="Cerrar"
                className="flex size-11 items-center justify-center text-cal"
              >
                <IconoCerrar />
              </button>
            </div>
            <ListaSecciones nav={nav} alElegir={() => setAbierto(false)} />
            <PieCuenta nav={nav} />
          </div>
        </div>
      ) : null}
    </>
  );
}
