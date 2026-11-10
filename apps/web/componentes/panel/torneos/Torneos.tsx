'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mensajeDe, panel } from '@/lib/api';
import { fechaCorta, nombreTipo } from '@/lib/formato';
import type { ConfigTorneo, TorneoResumen } from '@/lib/tipos';
import { ESTADO_TORNEO } from '../../torneos/VistaTorneo';
import { Aviso, Boton, Cargando, EncabezadoPagina, EstadoVacio, Insignia } from '../../ui';
import { Dialogo } from '../Dialogo';
import { alcanza, useClubActual } from '../sesion';
import { FormTorneo } from './FormTorneo';

export function Torneos() {
  const { clubId, club, rol } = useClubActual();
  const router = useRouter();
  const qc = useQueryClient();
  const [nuevo, setNuevo] = useState(false);
  const lista = useQuery({
    queryKey: ['torneos', clubId],
    queryFn: () => panel.get<TorneoResumen[]>(`/clubs/${clubId}/torneos`),
  });
  const crear = useMutation({
    mutationFn: (d: ConfigTorneo) => panel.post<{ id: string }>(`/clubs/${clubId}/torneos`, d),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['torneos', clubId] });
      router.push(`/panel/${clubId}/torneos/${r.id}`);
    },
  });
  const esAdmin = alcanza(rol, 'ADMIN');

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <EncabezadoPagina
        titulo="Torneos y ligas"
        bajada="Armá el torneo, sumá equipos y la app arma el fixture con días, horarios y canchas. Los jugadores ven la tabla y cuándo juegan en la página del club."
        acciones={esAdmin ? <Boton onClick={() => setNuevo(true)}>+ Nuevo torneo</Boton> : null}
      />
      {club?.slug ? (
        <p className="text-sm text-tenue">
          Página pública:{' '}
          <a
            href={`/${club.slug}/torneos`}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-acento-texto underline"
          >
            /{club.slug}/torneos
          </a>
        </p>
      ) : null}
      {lista.isPending ? (
        <Cargando />
      ) : lista.isError ? (
        <Aviso>{lista.error.message}</Aviso>
      ) : lista.data.length === 0 ? (
        <EstadoVacio titulo="Todavía no hay torneos.">
          Una liga es todos contra todos; con grupos, los mejores de cada uno pasan a una eliminación directa.
        </EstadoVacio>
      ) : (
        <ul className="flex flex-col border border-linea bg-superficie">
          {lista.data.map((t) => (
            <li key={t.id} className="border-b border-linea last:border-b-0">
              <Link
                href={`/panel/${clubId}/torneos/${t.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 hover:bg-superficie-2"
              >
                <span className="min-w-0">
                  <span className="block text-base font-bold">{t.nombre}</span>
                  <span className="text-sm text-tenue">
                    {nombreTipo(t.deporte, t.jugadoresPorLado)} · {t.equipos}{' '}
                    {t.equipos === 1 ? 'equipo' : 'equipos'} · desde el{' '}
                    {fechaCorta(t.fechaInicio).toLowerCase()}
                  </span>
                </span>
                <span className="flex flex-wrap gap-2">
                  {t.pendientes ? <Insignia tono="aviso">{t.pendientes} por aprobar</Insignia> : null}
                  <Insignia tono={ESTADO_TORNEO[t.estado].tono}>{ESTADO_TORNEO[t.estado].texto}</Insignia>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Dialogo abierto={nuevo} alCerrar={() => setNuevo(false)} titulo="Nuevo torneo">
        {nuevo ? (
          <FormTorneo
            enviando={crear.isPending}
            error={crear.error ? mensajeDe(crear.error) : null}
            alEnviar={(d) => crear.mutate(d)}
            textoBoton="Crear torneo"
          />
        ) : null}
      </Dialogo>
    </div>
  );
}
