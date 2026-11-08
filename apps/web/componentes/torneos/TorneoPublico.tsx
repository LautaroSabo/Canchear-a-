'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { mensajeDe, pedir } from '@/lib/api';
import { fechaLarga, fechaLocal, hora } from '@/lib/formato';
import type { VistaTorneo } from '@/lib/tipos';
import { Aviso, Boton, Campo, Insignia, Pestanas, Selector } from '../ui';
import { Cuadro, ESTADO_TORNEO, Fixture, resumenFormato, Tablas } from './VistaTorneo';

type Seccion = 'tabla' | 'fixture' | 'cuadro';

const leer = (clave: string) => {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
};
const guardar = (clave: string, valor: string) => {
  try {
    if (valor) localStorage.setItem(clave, valor);
    else localStorage.removeItem(clave);
  } catch {
    // Sin almacenamiento (modo privado): solo no se recuerda.
  }
};

export function TorneoPublico({
  club,
  inicial,
}: {
  club: { slug: string; zona: string };
  inicial: VistaTorneo;
}) {
  const datos = useQuery({
    queryKey: ['torneo-publico', club.slug, inicial.torneo.slug],
    queryFn: () => pedir<VistaTorneo>(`/public/clubs/${club.slug}/torneos/${inicial.torneo.slug}`),
    initialData: inicial,
    refetchInterval: 60_000,
  });
  const v = datos.data;
  const t = v.torneo;
  const clave = `torneo:${t.id}:equipo`;
  const [miEquipo, setMiEquipo] = useState('');
  useEffect(() => setMiEquipo(leer(clave) ?? ''), [clave]);
  const elegir = (id: string) => {
    setMiEquipo(id);
    guardar(clave, id);
  };
  const equipo = v.equipos.find((e) => e.id === miEquipo) ?? null;
  const hayCuadro = v.partidos.some((p) => p.fase === 'ELIMINACION');
  const [seccion, setSeccion] = useState<Seccion>(hayCuadro ? 'cuadro' : 'tabla');

  const proximo = equipo
    ? v.partidos
        .filter(
          (p) =>
            p.estado === 'PROGRAMADO' &&
            p.inicio &&
            (p.local?.id === equipo.id || p.visitante?.id === equipo.id),
        )
        .sort((a, b) => (a.inicio ?? '').localeCompare(b.inicio ?? ''))[0]
    : undefined;
  const fila = equipo
    ? v.grupos
        .flatMap((g) => g.tabla.map((f, i) => ({ ...f, pos: i + 1, grupo: g.numero })))
        .find((f) => f.equipo === equipo.id)
    : undefined;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <Link href={`/${club.slug}/torneos`} className="text-sm font-semibold text-acento-texto underline">
          Torneos del club
        </Link>
        <div className="flex flex-wrap items-end gap-3">
          <h1 className="font-display text-[44px] leading-none font-extrabold uppercase sm:text-[60px]">
            {t.nombre}
          </h1>
          <Insignia tono={ESTADO_TORNEO[t.estado].tono}>{ESTADO_TORNEO[t.estado].texto}</Insignia>
        </div>
        <p className="text-base text-tenue">{resumenFormato(t)}</p>
        {t.descripcion ? <p className="max-w-prose text-base whitespace-pre-line">{t.descripcion}</p> : null}
      </header>

      {t.estado === 'INSCRIPCION' ? (
        <Inscripcion club={club} vista={v} />
      ) : (
        <>
          <section
            aria-label="Mi equipo"
            className="flex flex-col gap-3 border border-linea bg-superficie p-4"
          >
            <div className="max-w-sm">
              <Selector etiqueta="Mi equipo" value={miEquipo} onChange={(e) => elegir(e.target.value)}>
                <option value="">Elegí tu equipo para ver tus partidos</option>
                {[...v.equipos]
                  .sort((a, b) => a.nombre.localeCompare(b.nombre))
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nombre}
                    </option>
                  ))}
              </Selector>
            </div>
            {equipo ? (
              <div className="flex flex-wrap gap-x-8 gap-y-3">
                <div>
                  <p className="text-sm text-tenue">Próximo partido</p>
                  {proximo?.inicio ? (
                    <p className="text-base font-semibold">
                      {fechaLarga(fechaLocal(proximo.inicio, club.zona))} a las{' '}
                      {hora(proximo.inicio, club.zona)}
                      {proximo.cancha ? ` · ${proximo.cancha}` : ''}
                      <span className="block font-normal text-tenue">
                        contra{' '}
                        {(proximo.local?.id === equipo.id ? proximo.visitante : proximo.local)?.nombre ??
                          'a definir'}
                      </span>
                    </p>
                  ) : (
                    <p className="text-base font-semibold">No tiene partidos por jugar.</p>
                  )}
                </div>
                {fila ? (
                  <div>
                    <p className="text-sm text-tenue">
                      Posición
                      {v.grupos.length > 1 ? ` en el grupo ${String.fromCharCode(64 + fila.grupo)}` : ''}
                    </p>
                    <p className="cifras text-base font-semibold">
                      {fila.pos}° · {fila.pts} pts · {fila.pg}G {fila.pe}E {fila.pp}P
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <Pestanas
            id="torneo"
            etiqueta="Secciones del torneo"
            valor={seccion}
            onCambio={setSeccion}
            opciones={[
              { valor: 'tabla', etiqueta: v.grupos.length > 1 ? 'Grupos' : 'Tabla' },
              { valor: 'fixture', etiqueta: equipo ? 'Mis partidos' : 'Fixture' },
              ...(hayCuadro ? [{ valor: 'cuadro' as const, etiqueta: 'Eliminación' }] : []),
            ]}
          />
          <div id="torneo-panel" role="tabpanel" aria-labelledby={`torneo-tab-${seccion}`}>
            {seccion === 'tabla' ? (
              <Tablas vista={v} destacado={miEquipo || null} />
            ) : seccion === 'fixture' ? (
              <Fixture vista={v} zona={club.zona} destacado={miEquipo || null} />
            ) : (
              <Cuadro vista={v} zona={club.zona} destacado={miEquipo || null} />
            )}
          </div>
        </>
      )}
    </main>
  );
}

function Inscripcion({ club, vista: v }: { club: { slug: string }; vista: VistaTorneo }) {
  const [listo, setListo] = useState<string | null>(null);
  const inscribir = useMutation({
    mutationFn: (d: { nombre: string; delegadoNombre: string; delegadoTelefono: string }) =>
      pedir(`/public/clubs/${club.slug}/torneos/${v.torneo.slug}/inscripcion`, { metodo: 'POST', json: d }),
    onSuccess: (_r, d) => setListo(d.nombre),
  });
  function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    inscribir.mutate({
      nombre: String(f.get('nombre') ?? ''),
      delegadoNombre: String(f.get('delegado') ?? ''),
      delegadoTelefono: String(f.get('telefono') ?? ''),
    });
  }
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section aria-label="Equipos inscriptos">
        <h2 className="mb-2 font-display text-2xl font-bold uppercase">Equipos ({v.equipos.length})</h2>
        <p className="mb-3 text-sm text-tenue">
          Empieza el {fechaLarga(v.torneo.fechaInicio).toLowerCase()}. Cuando cierre la inscripción, el club
          sortea los grupos y acá van a aparecer los horarios de cada partido.
        </p>
        {v.equipos.length ? (
          <ul className="border border-linea">
            {v.equipos.map((e) => (
              <li key={e.id} className="border-b border-linea px-4 py-2.5 last:border-b-0">
                {e.nombre}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-tenue">Todavía no hay equipos confirmados.</p>
        )}
      </section>
      {v.torneo.inscripcionOnline ? (
        <section
          aria-label="Inscribir mi equipo"
          className="flex flex-col gap-4 border border-linea bg-superficie p-5"
        >
          <h2 className="font-display text-2xl font-bold uppercase">Inscribí tu equipo</h2>
          {listo ? (
            <Aviso tipo="ok">
              Listo: anotamos a <strong>{listo}</strong>. El club tiene que confirmar la inscripción; cuando
              lo haga, el equipo aparece en la lista.
            </Aviso>
          ) : (
            <form onSubmit={enviar} className="flex flex-col gap-4">
              <Campo etiqueta="Nombre del equipo" name="nombre" required maxLength={60} autoComplete="off" />
              <Campo
                etiqueta="Delegado (quién se encarga)"
                name="delegado"
                required
                maxLength={80}
                autoComplete="name"
              />
              <Campo
                etiqueta="WhatsApp del delegado"
                name="telefono"
                type="tel"
                required
                minLength={6}
                maxLength={30}
                autoComplete="tel"
                ayuda="Solo lo ve el club, para coordinar."
              />
              {inscribir.error ? <Aviso>{mensajeDe(inscribir.error)}</Aviso> : null}
              <Boton type="submit" grande disabled={inscribir.isPending}>
                {inscribir.isPending ? 'Enviando…' : 'Inscribir equipo'}
              </Boton>
            </form>
          )}
        </section>
      ) : (
        <Aviso tipo="info">La inscripción a este torneo se hace directamente con el club.</Aviso>
      )}
    </div>
  );
}
