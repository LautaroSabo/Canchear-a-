'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { mensajeDe, panel, pedir } from '@/lib/api';
import { fechaLocal, hora, instanteLocal, linkWhatsApp, telefonoLegible } from '@/lib/formato';
import type { ClubPublico, ConfigTorneo, EquipoTorneo, PartidoTorneo, VistaTorneo } from '@/lib/tipos';
import {
  Cuadro,
  cuando,
  ESTADO_TORNEO,
  Fixture,
  letraGrupo,
  resumenFormato,
  Tablas,
} from '../../torneos/VistaTorneo';
import { Aviso, Boton, Campo, Cargando, Copiable, Insignia, Pestanas, Selector } from '../../ui';
import { Dialogo } from '../Dialogo';
import { alcanza, useClubActual } from '../sesion';
import { FormTorneo } from './FormTorneo';

type Seccion = 'equipos' | 'partidos' | 'tablas' | 'cuadro';

export function DetalleTorneo({ torneoId }: { torneoId: string }) {
  const { clubId, club, rol, zona } = useClubActual();
  const qc = useQueryClient();
  const router = useRouter();
  const ruta = `/clubs/${clubId}/torneos/${torneoId}`;
  const clave = ['torneo', clubId, torneoId];
  const datos = useQuery({ queryKey: clave, queryFn: () => panel.get<VistaTorneo>(ruta) });
  const [seccion, setSeccion] = useState<Seccion | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<
    { tipo: 'editar' } | { tipo: 'empezar' } | { tipo: 'resultado' | 'mover'; partido: PartidoTorneo } | null
  >(null);
  const esAdmin = alcanza(rol, 'ADMIN');

  const refrescar = (v?: VistaTorneo) => {
    if (v) qc.setQueryData(clave, v);
    else qc.invalidateQueries({ queryKey: clave });
    qc.invalidateQueries({ queryKey: ['torneos', clubId] });
    qc.invalidateQueries({ queryKey: ['agenda', clubId] });
  };
  const accion = useMutation({
    mutationFn: async (a: { tipo: 'eliminacion' | 'finalizar' | 'borrar' | 'empezar' }) => {
      if (a.tipo === 'borrar') return panel.borrar(ruta);
      if (a.tipo === 'empezar') return panel.post<VistaTorneo>(`${ruta}/iniciar`, {});
      if (a.tipo === 'eliminacion') return panel.post<VistaTorneo>(`${ruta}/eliminacion`, {});
      return panel.post(`${ruta}/finalizar`, {});
    },
    onSuccess: (v, a) => {
      setDialogo(null);
      if (a.tipo === 'borrar') {
        qc.invalidateQueries({ queryKey: ['torneos', clubId] });
        router.push(`/panel/${clubId}/torneos`);
        return;
      }
      refrescar((v as VistaTorneo | undefined) ?? undefined);
      if (a.tipo === 'empezar') {
        setSeccion('partidos');
        setAviso('Torneo en marcha: los partidos quedaron agendados y bloqueados en la agenda.');
      }
      if (a.tipo === 'eliminacion') {
        setSeccion('cuadro');
        setAviso(
          'Cuadro armado: las rondas quedaron agendadas. Los equipos se completan con cada resultado.',
        );
      }
    },
  });

  if (datos.isPending) return <Cargando />;
  if (datos.isError) return <Aviso>{datos.error.message}</Aviso>;
  const v = datos.data;
  const t = v.torneo;
  const hayCuadro = v.partidos.some((p) => p.fase === 'ELIMINACION');
  const actual: Seccion =
    seccion ?? (t.estado === 'INSCRIPCION' ? 'equipos' : hayCuadro ? 'cuadro' : 'partidos');

  const accionesPartido = (p: PartidoTorneo) =>
    p.local && p.visitante ? (
      <span className="flex gap-1">
        <Boton
          variante="fantasma"
          className="min-h-9"
          onClick={() => setDialogo({ tipo: 'resultado', partido: p })}
        >
          {p.estado === 'JUGADO' ? 'Corregir' : 'Cargar resultado'}
        </Boton>
        {esAdmin && p.estado !== 'JUGADO' ? (
          <Boton
            variante="fantasma"
            className="min-h-9"
            onClick={() => setDialogo({ tipo: 'mover', partido: p })}
          >
            Mover
          </Boton>
        ) : null}
      </span>
    ) : esAdmin && p.estado !== 'JUGADO' && p.inicio ? (
      <Boton
        variante="fantasma"
        className="min-h-9"
        onClick={() => setDialogo({ tipo: 'mover', partido: p })}
      >
        Mover
      </Boton>
    ) : null;

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <Link href={`/panel/${clubId}/torneos`} className="text-sm font-semibold text-acento-texto underline">
        Todos los torneos
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-[40px] leading-none font-bold">{t.nombre}</h1>
            <Insignia tono={ESTADO_TORNEO[t.estado].tono}>{ESTADO_TORNEO[t.estado].texto}</Insignia>
          </div>
          <p className="mt-2 text-base text-tenue">{resumenFormato(t)}</p>
          {club?.slug ? (
            <a
              href={`/${club.slug}/torneos/${t.slug}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-semibold text-acento-texto underline"
            >
              Ver página pública
            </a>
          ) : null}
        </div>
        {esAdmin ? (
          <div className="flex flex-wrap gap-2">
            {t.estado === 'INSCRIPCION' ? (
              <>
                <Boton variante="secundario" onClick={() => setDialogo({ tipo: 'editar' })}>
                  Editar
                </Boton>
                <Boton onClick={() => setDialogo({ tipo: 'empezar' })}>Sortear y armar fixture</Boton>
              </>
            ) : null}
            {v.eliminacionPendiente ? (
              <Boton disabled={accion.isPending} onClick={() => accion.mutate({ tipo: 'eliminacion' })}>
                Armar eliminación
              </Boton>
            ) : null}
            {t.estado === 'EN_CURSO' ? (
              <Boton
                variante="secundario"
                disabled={accion.isPending}
                onClick={() => {
                  if (
                    window.confirm('¿Dar por terminado el torneo? Los partidos sin jugar quedan como están.')
                  )
                    accion.mutate({ tipo: 'finalizar' });
                }}
              >
                Terminar torneo
              </Boton>
            ) : null}
          </div>
        ) : null}
      </header>
      {aviso ? <Aviso tipo="ok">{aviso}</Aviso> : null}
      {t.estado === 'INSCRIPCION' && club?.slug ? (
        t.inscripcionOnline ? (
          <div className="border border-linea bg-superficie px-4 pt-3 pb-1">
            <p className="text-sm">
              <strong>Inscripción online abierta.</strong> Pasales este link a los equipos: se anotan desde
              ahí y acá te aparecen para aprobar. Cuando sortees el fixture, la inscripción se cierra.
            </p>
            <Copiable
              etiqueta="Link de inscripción"
              valor={`${typeof window === 'undefined' ? '' : window.location.origin}/${club.slug}/torneos/${t.slug}`}
            />
          </div>
        ) : (
          <Aviso tipo="info">
            La inscripción online está apagada: los equipos los cargás vos abajo. Para que se anoten solos,
            tocá «Editar» y marcá «Inscripción online».
          </Aviso>
        )
      ) : null}
      {accion.error && !dialogo ? <Aviso>{mensajeDe(accion.error)}</Aviso> : null}
      {v.eliminacionPendiente ? (
        <Aviso tipo="info">
          Se jugaron todos los partidos de grupos. Ya podés armar el cuadro de eliminación.
        </Aviso>
      ) : null}

      <Pestanas
        id="detalle-torneo"
        etiqueta="Secciones del torneo"
        valor={actual}
        onCambio={setSeccion}
        opciones={[
          {
            valor: 'equipos',
            etiqueta: 'Equipos',
            cuenta: v.equipos.filter((e) => e.estado === 'PENDIENTE').length,
          },
          ...(t.estado !== 'INSCRIPCION'
            ? [
                { valor: 'partidos' as const, etiqueta: 'Partidos' },
                { valor: 'tablas' as const, etiqueta: v.grupos.length > 1 ? 'Grupos' : 'Tabla' },
              ]
            : []),
          ...(hayCuadro ? [{ valor: 'cuadro' as const, etiqueta: 'Eliminación' }] : []),
        ]}
      />
      <div id="detalle-torneo-panel" role="tabpanel" aria-labelledby={`detalle-torneo-tab-${actual}`}>
        {actual === 'equipos' ? (
          <Equipos vista={v} ruta={ruta} esAdmin={esAdmin} alCambiar={() => refrescar()} />
        ) : actual === 'partidos' ? (
          <Fixture vista={v} zona={zona} acciones={accionesPartido} />
        ) : actual === 'tablas' ? (
          <Tablas vista={v} />
        ) : (
          <Cuadro vista={v} zona={zona} acciones={accionesPartido} />
        )}
      </div>

      {esAdmin && t.estado === 'INSCRIPCION' ? (
        <div>
          <Boton
            variante="peligro"
            disabled={accion.isPending}
            onClick={() => {
              if (window.confirm(`¿Borrar «${t.nombre}» con sus equipos?`)) accion.mutate({ tipo: 'borrar' });
            }}
          >
            Borrar torneo
          </Boton>
        </div>
      ) : null}

      <Dialogo
        abierto={dialogo !== null}
        alCerrar={() => setDialogo(null)}
        titulo={
          dialogo?.tipo === 'editar'
            ? 'Editar torneo'
            : dialogo?.tipo === 'empezar'
              ? 'Sortear y armar fixture'
              : dialogo?.tipo === 'mover'
                ? 'Mover partido'
                : 'Resultado'
        }
      >
        {dialogo?.tipo === 'editar' ? (
          <Editar
            vista={v}
            ruta={ruta}
            alGuardar={() => {
              setDialogo(null);
              refrescar();
            }}
          />
        ) : dialogo?.tipo === 'empezar' ? (
          <div className="flex flex-col gap-4">
            <p className="text-base">
              Se sortean los {v.equipos.filter((e) => e.estado === 'APROBADO').length} equipos aprobados
              {t.cantidadGrupos > 1 ? ` en ${t.cantidadGrupos} grupos` : ''} y la app agenda cada partido en
              un horario libre, bloqueándolo en la agenda. Después ya no se pueden sumar equipos.
            </p>
            {v.equipos.some((e) => e.estado === 'PENDIENTE') ? (
              <Aviso tipo="ambar">Hay inscripciones sin aprobar: esos equipos no van a entrar.</Aviso>
            ) : null}
            {accion.error ? <Aviso>{mensajeDe(accion.error)}</Aviso> : null}
            <Boton disabled={accion.isPending} onClick={() => accion.mutate({ tipo: 'empezar' })}>
              {accion.isPending ? 'Armando…' : 'Sortear y agendar'}
            </Boton>
          </div>
        ) : dialogo?.tipo === 'resultado' ? (
          <Resultado
            partido={dialogo.partido}
            ruta={ruta}
            alGuardar={(nv) => {
              setDialogo(null);
              refrescar(nv);
            }}
          />
        ) : dialogo?.tipo === 'mover' ? (
          <Mover
            partido={dialogo.partido}
            ruta={ruta}
            canchaIds={t.canchaIds}
            alGuardar={(nv) => {
              setDialogo(null);
              refrescar(nv);
            }}
          />
        ) : null}
      </Dialogo>
    </div>
  );
}

function Equipos({
  vista: v,
  ruta,
  esAdmin,
  alCambiar,
}: {
  vista: VistaTorneo;
  ruta: string;
  esAdmin: boolean;
  alCambiar: () => void;
}) {
  const abierto = v.torneo.estado === 'INSCRIPCION';
  const agregar = useMutation({
    mutationFn: (d: { nombre: string; delegadoNombre: string; delegadoTelefono: string }) =>
      panel.post(`${ruta}/equipos`, d),
    onSuccess: alCambiar,
  });
  const cambiar = useMutation({
    mutationFn: ({ e, estado }: { e: EquipoTorneo; estado: 'APROBADO' | 'RECHAZADO' | 'QUITAR' }) =>
      estado === 'QUITAR'
        ? panel.borrar(`${ruta}/equipos/${e.id}`)
        : panel.patch(`${ruta}/equipos/${e.id}`, { estado }),
    onSuccess: alCambiar,
  });
  function enviar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const f = new FormData(form);
    agregar.mutate(
      {
        nombre: String(f.get('nombre')),
        delegadoNombre: String(f.get('delegado')),
        delegadoTelefono: String(f.get('telefono')),
      },
      { onSuccess: () => form.reset() },
    );
  }
  const orden = { PENDIENTE: 0, APROBADO: 1, RECHAZADO: 2 } as const;
  const lista = [...v.equipos].sort(
    (a, b) =>
      orden[a.estado] - orden[b.estado] ||
      (a.grupo ?? 0) - (b.grupo ?? 0) ||
      a.nombre.localeCompare(b.nombre),
  );

  return (
    <div className="flex flex-col gap-4">
      {cambiar.error ? <Aviso>{mensajeDe(cambiar.error)}</Aviso> : null}
      {lista.length === 0 ? (
        <p className="text-sm text-tenue">
          Todavía no hay equipos.{' '}
          {v.torneo.inscripcionOnline
            ? 'Compartí la página pública para que se anoten, o cargalos acá.'
            : 'Cargalos acá.'}
        </p>
      ) : (
        <ul className="border border-linea bg-superficie">
          {lista.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-linea px-4 py-3 last:border-b-0"
            >
              <span className="min-w-0">
                <span className="block font-semibold">
                  {e.nombre}
                  {e.grupo && v.torneo.cantidadGrupos > 1 ? (
                    <span className="ml-2 text-sm font-normal text-tenue">Grupo {letraGrupo(e.grupo)}</span>
                  ) : null}
                </span>
                {e.delegadoTelefono ? (
                  <span className="text-sm text-tenue">
                    {e.delegadoNombre} ·{' '}
                    <a href={linkWhatsApp(e.delegadoTelefono)} className="underline">
                      {telefonoLegible(e.delegadoTelefono)}
                    </a>
                  </span>
                ) : null}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {e.estado === 'PENDIENTE' ? <Insignia tono="aviso">Inscripción online</Insignia> : null}
                {e.estado === 'RECHAZADO' ? <Insignia tono="neutro">Rechazado</Insignia> : null}
                {abierto && esAdmin ? (
                  <>
                    {e.estado !== 'APROBADO' ? (
                      <Boton
                        variante="secundario"
                        disabled={cambiar.isPending}
                        onClick={() => cambiar.mutate({ e, estado: 'APROBADO' })}
                      >
                        Aprobar
                      </Boton>
                    ) : null}
                    {e.estado === 'PENDIENTE' ? (
                      <Boton
                        variante="fantasma"
                        disabled={cambiar.isPending}
                        onClick={() => cambiar.mutate({ e, estado: 'RECHAZADO' })}
                      >
                        Rechazar
                      </Boton>
                    ) : (
                      <Boton
                        variante="fantasma"
                        disabled={cambiar.isPending}
                        onClick={() => {
                          if (window.confirm(`¿Quitar a ${e.nombre} del torneo?`))
                            cambiar.mutate({ e, estado: 'QUITAR' });
                        }}
                      >
                        Quitar
                      </Boton>
                    )}
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {abierto && esAdmin ? (
        <form onSubmit={enviar} className="flex flex-col gap-3 border border-linea bg-superficie p-4">
          <h2 className="text-base font-bold">Agregar equipo</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo etiqueta="Equipo" name="nombre" required maxLength={60} autoComplete="off" />
            <Campo etiqueta="Delegado" name="delegado" required maxLength={80} autoComplete="off" />
            <Campo
              etiqueta="WhatsApp"
              name="telefono"
              type="tel"
              required
              minLength={6}
              maxLength={30}
              autoComplete="off"
            />
          </div>
          {agregar.error ? <Aviso>{mensajeDe(agregar.error)}</Aviso> : null}
          <div>
            <Boton type="submit" disabled={agregar.isPending}>
              Agregar
            </Boton>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function Editar({ vista: v, ruta, alGuardar }: { vista: VistaTorneo; ruta: string; alGuardar: () => void }) {
  const guardar = useMutation({ mutationFn: (d: ConfigTorneo) => panel.put(ruta, d), onSuccess: alGuardar });
  return (
    <FormTorneo
      inicial={v.torneo}
      enviando={guardar.isPending}
      error={guardar.error ? mensajeDe(guardar.error) : null}
      alEnviar={(d) => guardar.mutate(d)}
      textoBoton="Guardar cambios"
    />
  );
}

function Resultado({
  partido: p,
  ruta,
  alGuardar,
}: {
  partido: PartidoTorneo;
  ruta: string;
  alGuardar: (v: VistaTorneo) => void;
}) {
  const [gl, setGl] = useState(p.golesLocal?.toString() ?? '');
  const [gv, setGv] = useState(p.golesVisitante?.toString() ?? '');
  const empate = p.fase === 'ELIMINACION' && gl !== '' && gl === gv;
  const guardar = useMutation({
    mutationFn: (d: Record<string, number | null>) =>
      panel.put<VistaTorneo>(`${ruta}/partidos/${p.id}/resultado`, d),
    onSuccess: alGuardar,
  });
  function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    guardar.mutate({
      golesLocal: Number(gl),
      golesVisitante: Number(gv),
      penalesLocal: empate ? Number(f.get('pl')) : null,
      penalesVisitante: empate ? Number(f.get('pv')) : null,
    });
  }
  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <Campo
          etiqueta={p.local?.nombre}
          type="number"
          inputMode="numeric"
          min={0}
          max={99}
          required
          value={gl}
          onChange={(e) => setGl(e.target.value)}
        />
        <Campo
          etiqueta={p.visitante?.nombre}
          type="number"
          inputMode="numeric"
          min={0}
          max={99}
          required
          value={gv}
          onChange={(e) => setGv(e.target.value)}
        />
      </div>
      {empate ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-semibold">Empate: penales</legend>
          <div className="grid grid-cols-2 gap-4">
            <Campo
              etiqueta={`Penales ${p.local?.nombre}`}
              name="pl"
              type="number"
              min={0}
              max={99}
              required
              defaultValue={p.penalesLocal ?? ''}
            />
            <Campo
              etiqueta={`Penales ${p.visitante?.nombre}`}
              name="pv"
              type="number"
              min={0}
              max={99}
              required
              defaultValue={p.penalesVisitante ?? ''}
            />
          </div>
        </fieldset>
      ) : null}
      {guardar.error ? <Aviso>{mensajeDe(guardar.error)}</Aviso> : null}
      <Boton type="submit" disabled={guardar.isPending}>
        Guardar resultado
      </Boton>
    </form>
  );
}

function Mover({
  partido: p,
  ruta,
  canchaIds,
  alGuardar,
}: {
  partido: PartidoTorneo;
  ruta: string;
  canchaIds: string[];
  alGuardar: (v: VistaTorneo) => void;
}) {
  const { club, zona } = useClubActual();
  const publico = useQuery({
    queryKey: ['club-publico', club?.slug],
    queryFn: () => pedir<ClubPublico>(`/public/clubs/${club?.slug}`),
    enabled: Boolean(club?.slug),
  });
  const canchas = (publico.data?.canchas ?? []).sort(
    (a, b) => Number(canchaIds.includes(b.id)) - Number(canchaIds.includes(a.id)),
  );
  const mover = useMutation({
    mutationFn: (d: { inicio: string; canchaId: string }) =>
      panel.post<VistaTorneo>(`${ruta}/partidos/${p.id}/mover`, d),
    onSuccess: alGuardar,
  });
  function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    mover.mutate({
      inicio: instanteLocal(String(f.get('fecha')), String(f.get('hora')), zona),
      canchaId: String(f.get('cancha')),
    });
  }
  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <p className="text-sm text-tenue">
        {p.local?.nombre ?? 'A definir'} vs {p.visitante?.nombre ?? 'a definir'}
        {cuando(p, zona) ? ` · ahora: ${cuando(p, zona)}` : ''}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          etiqueta="Día"
          name="fecha"
          type="date"
          required
          defaultValue={p.inicio ? fechaLocal(p.inicio, zona) : ''}
        />
        <Campo
          etiqueta="Hora"
          name="hora"
          type="time"
          required
          defaultValue={p.inicio ? hora(p.inicio, zona) : ''}
        />
      </div>
      <Selector etiqueta="Cancha" name="cancha" required defaultValue={p.canchaId ?? ''}>
        {canchas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </Selector>
      <p className="text-sm text-tenue">Se libera el horario de antes y se bloquea el nuevo en la agenda.</p>
      {mover.error ? <Aviso>{mensajeDe(mover.error)}</Aviso> : null}
      <Boton type="submit" disabled={mover.isPending}>
        Mover partido
      </Boton>
    </form>
  );
}
