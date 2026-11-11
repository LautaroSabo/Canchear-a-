'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { mensajeDe, panel } from '@/lib/api';
import { fechaCorta, linkWhatsApp, pesos, sumarDias, telefonoLegible } from '@/lib/formato';
import type { ClubPlataforma, PagoAbono, PlanAbono } from '@/lib/tipos';
import {
  Aviso,
  Boton,
  Campo,
  Cargando,
  Copiable,
  EncabezadoPagina,
  EstadoVacio,
  Insignia,
  Pestanas,
  Segmentado,
  Selector,
  Tarjeta,
  type Tono,
} from '../ui';
import { Dialogo } from './Dialogo';
import { useSesion } from './sesion';

type Filtro = 'pendientes' | 'activos' | 'vencidos' | 'suspendidos' | 'todos';
type Accion = {
  tipo: 'aprobar' | 'suspender' | 'pago' | 'contrasena' | 'especial';
  club: ClubPlataforma;
} | null;

const MEDIOS = {
  TRANSFERENCIA: 'Transferencia',
  MERCADO_PAGO: 'Mercado Pago',
  EFECTIVO: 'Efectivo',
  OTRO: 'Otro',
};
const DIAS_AVISO = 5;

/** "2030-01-18" → días entre hoy y esa fecha (negativo si ya pasó). */
function diasHasta(hoy: string, fecha: string) {
  return Math.round((Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000);
}

function situacionAbono(c: ClubPlataforma, hoy: string): { texto: string; tono: Tono } {
  if (!c.abonoHasta) return { texto: 'Sin abono', tono: 'neutro' };
  const dias = diasHasta(hoy, c.abonoHasta);
  if (dias < 0) return { texto: `Vencido hace ${-dias} ${dias === -1 ? 'día' : 'días'}`, tono: 'error' };
  if (dias <= DIAS_AVISO) return { texto: `Vence en ${dias} ${dias === 1 ? 'día' : 'días'}`, tono: 'aviso' };
  return { texto: `Pago hasta ${fechaCorta(c.abonoHasta)}`, tono: 'ok' };
}

const vencidoOPorVencer = (c: ClubPlataforma, hoy: string) =>
  c.estado === 'ACTIVO' && (!c.abonoHasta || c.abonoHasta <= sumarDias(hoy, DIAS_AVISO));

export function Plataforma() {
  const sesion = useSesion();
  const [filtro, setFiltro] = useState<Filtro>('pendientes');
  const [accion, setAccion] = useState<Accion>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const datos = useQuery({
    queryKey: ['plataforma'],
    queryFn: () => panel.get<{ hoy: string; clubs: ClubPlataforma[] }>('/plataforma/clubs'),
    enabled: Boolean(sesion.data?.usuario.esSuperadmin),
  });

  if (sesion.data && !sesion.data.usuario.esSuperadmin) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <EstadoVacio titulo="Esta sección es solo para quien administra Canchería." />
      </main>
    );
  }
  const hoy = datos.data?.hoy ?? '';
  const clubs = datos.data?.clubs ?? [];
  const CUMPLE: Record<Filtro, (c: ClubPlataforma) => boolean> = {
    pendientes: (c) => c.estado === 'PENDIENTE',
    activos: (c) => c.estado === 'ACTIVO',
    vencidos: (c) => vencidoOPorVencer(c, hoy),
    suspendidos: (c) => c.estado === 'SUSPENDIDO',
    todos: () => true,
  };
  const cuenta = (f: Filtro) => clubs.filter(CUMPLE[f]).length;
  const visibles = clubs.filter(CUMPLE[filtro]);
  const miClub = sesion.data?.clubs[0];

  return (
    <div className="min-h-screen">
      <header className="tema-noche flex min-h-14 items-center justify-between gap-4 bg-noche px-4 sm:px-6">
        <span className="font-display text-2xl font-extrabold text-cal uppercase">
          Canchería · Plataforma
        </span>
        {miClub ? (
          <Link
            href={`/panel/${miClub.id}/agenda`}
            className="text-sm font-semibold text-[#c9d5cc] underline"
          >
            Ir a {miClub.nombre}
          </Link>
        ) : null}
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
        <EncabezadoPagina
          titulo="Clubes"
          bajada="Aprobá los clubes nuevos, registrá los pagos del abono y pausá a quien no pague."
        />
        {aviso ? <Aviso tipo="ok">{aviso}</Aviso> : null}
        <EditorPlanes alGuardar={setAviso} />
        <Pestanas
          id="plataforma"
          etiqueta="Filtrar clubes"
          valor={filtro}
          onCambio={setFiltro}
          opciones={[
            { valor: 'pendientes', etiqueta: 'Por aprobar', cuenta: cuenta('pendientes') },
            { valor: 'vencidos', etiqueta: 'Abono por cobrar', cuenta: cuenta('vencidos') },
            { valor: 'activos', etiqueta: 'Activos' },
            { valor: 'suspendidos', etiqueta: 'Suspendidos' },
            { valor: 'todos', etiqueta: 'Todos' },
          ]}
        />
        <div id="plataforma-panel" role="tabpanel" aria-labelledby={`plataforma-tab-${filtro}`}>
          {datos.isPending ? (
            <Cargando />
          ) : datos.isError ? (
            <Aviso>{datos.error.message}</Aviso>
          ) : visibles.length === 0 ? (
            <EstadoVacio titulo="No hay clubes acá." />
          ) : (
            <ul className="flex flex-col border border-linea bg-superficie">
              {visibles.map((c) => (
                <FilaClub key={c.id} c={c} hoy={hoy} alElegir={setAccion} />
              ))}
            </ul>
          )}
        </div>
      </main>

      <DialogoAccion
        accion={accion}
        alCerrar={() => setAccion(null)}
        alHacer={(m) => {
          setAccion(null);
          setAviso(m);
        }}
      />
    </div>
  );
}

function FilaClub({ c, hoy, alElegir }: { c: ClubPlataforma; hoy: string; alElegir: (a: Accion) => void }) {
  const [verPagos, setVerPagos] = useState(false);
  const qc = useQueryClient();
  const reactivar = useMutation({
    mutationFn: () => panel.post(`/plataforma/clubs/${c.id}/reactivar`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plataforma'] }),
  });
  const abono = situacionAbono(c, hoy);
  const estado: { texto: string; tono: Tono } =
    c.estado === 'PENDIENTE'
      ? { texto: 'Por aprobar', tono: 'info' }
      : c.estado === 'SUSPENDIDO'
        ? { texto: 'Suspendido', tono: 'error' }
        : { texto: 'Activo', tono: 'ok' };

  return (
    <li className="flex flex-col gap-3 border-b border-linea px-5 py-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-[28px] leading-none font-bold">{c.nombre}</h2>
            <Insignia tono={estado.tono}>{estado.texto}</Insignia>
            {c.estado !== 'PENDIENTE' ? <Insignia tono={abono.tono}>{abono.texto}</Insignia> : null}
          </div>
          <p className="mt-1 text-sm text-tenue">
            <a href={`/${c.slug}`} target="_blank" rel="noopener" className="underline">
              /{c.slug}
            </a>{' '}
            · registrado el {fechaCorta(c.creadoEn.slice(0, 10))} · {c.canchas}{' '}
            {c.canchas === 1 ? 'cancha' : 'canchas'} · {c.turnosUltimos30Dias} turnos en 30 días
          </p>
          <p className="mt-1 text-sm">
            {c.dueno ? (
              <>
                {c.dueno.nombre} ·{' '}
                <a href={`mailto:${c.dueno.email}`} className="underline">
                  {c.dueno.email}
                </a>
              </>
            ) : (
              'Sin dueño'
            )}
            {c.telefono ? (
              <>
                {' '}
                ·{' '}
                <a href={linkWhatsApp(c.telefono)} className="underline">
                  {telefonoLegible(c.telefono)}
                </a>
              </>
            ) : null}
          </p>
          {c.abono?.plan ? (
            <p className="mt-1 text-sm">
              Plan <strong>{c.abono.plan.nombre}</strong> ({c.abono.canchas}{' '}
              {c.abono.canchas === 1 ? 'cancha activa' : 'canchas activas'}) ·{' '}
              <strong className="cifras">{pesos(c.abono.precio ?? 0)}/mes</strong>
              {c.abono.especial ? (
                <>
                  {' '}
                  <Insignia tono="info">
                    {c.abono.especial.descuentoPct !== null
                      ? `−${c.abono.especial.descuentoPct}%`
                      : 'Precio fijo'}
                    {c.abono.especial.motivo ? ` · ${c.abono.especial.motivo}` : ''}
                    {c.abono.especial.hasta ? ` · hasta ${fechaCorta(c.abono.especial.hasta)}` : ''}
                  </Insignia>{' '}
                  <span className="text-tenue line-through">{pesos(c.abono.precioLista ?? 0)}</span>
                </>
              ) : null}
            </p>
          ) : null}
          {c.motivoSuspension ? (
            <p className="mt-1 text-sm text-error-texto">Motivo: {c.motivoSuspension}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {c.estado === 'PENDIENTE' ? (
            <Boton onClick={() => alElegir({ tipo: 'aprobar', club: c })}>Aprobar</Boton>
          ) : (
            <Boton variante="secundario" onClick={() => alElegir({ tipo: 'pago', club: c })}>
              Registrar pago
            </Boton>
          )}
          {c.estado === 'ACTIVO' ? (
            <Boton variante="peligro" onClick={() => alElegir({ tipo: 'suspender', club: c })}>
              Suspender
            </Boton>
          ) : null}
          {c.estado === 'SUSPENDIDO' ? (
            <Boton disabled={reactivar.isPending} onClick={() => reactivar.mutate()}>
              Reactivar
            </Boton>
          ) : null}
          <Boton variante="fantasma" onClick={() => alElegir({ tipo: 'especial', club: c })}>
            Precio especial
          </Boton>
          {c.dueno ? (
            <Boton variante="fantasma" onClick={() => alElegir({ tipo: 'contrasena', club: c })}>
              Contraseña del dueño
            </Boton>
          ) : null}
          {c.estado !== 'PENDIENTE' ? (
            <Boton variante="fantasma" aria-expanded={verPagos} onClick={() => setVerPagos(!verPagos)}>
              {verPagos ? 'Ocultar pagos' : 'Ver pagos'}
            </Boton>
          ) : null}
        </div>
      </div>
      {reactivar.error ? <Aviso>{mensajeDe(reactivar.error)}</Aviso> : null}
      {verPagos ? <PagosDelClub clubId={c.id} /> : null}
    </li>
  );
}

function PagosDelClub({ clubId }: { clubId: string }) {
  const pagos = useQuery({
    queryKey: ['plataforma', 'pagos', clubId],
    queryFn: () => panel.get<PagoAbono[]>(`/plataforma/clubs/${clubId}/pagos`),
  });
  if (pagos.isPending) return <Cargando />;
  if (pagos.isError) return <Aviso>{pagos.error.message}</Aviso>;
  if (pagos.data.length === 0) return <p className="text-sm text-tenue">Todavía no registraste pagos.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-tenue">
          <th scope="col" className="py-1 font-semibold">
            Cargado
          </th>
          <th scope="col" className="py-1 font-semibold">
            Cubre
          </th>
          <th scope="col" className="py-1 font-semibold">
            Medio
          </th>
          <th scope="col" className="py-1 text-right font-semibold">
            Monto
          </th>
        </tr>
      </thead>
      <tbody>
        {pagos.data.map((p) => (
          <tr key={p.id} className="border-t border-linea">
            <td className="py-1.5">{fechaCorta(p.creadoEn.slice(0, 10))}</td>
            <td className="py-1.5">
              {fechaCorta(p.desde)} al {fechaCorta(p.hasta)}
              {p.nota ? <span className="text-tenue"> · {p.nota}</span> : null}
            </td>
            <td className="py-1.5">{MEDIOS[p.medio as keyof typeof MEDIOS] ?? p.medio}</td>
            <td className="py-1.5 text-right font-semibold">{pesos(p.monto)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DialogoAccion({
  accion,
  alCerrar,
  alHacer,
}: {
  accion: Accion;
  alCerrar: () => void;
  alHacer: (mensaje: string) => void;
}) {
  const titulo = !accion
    ? ''
    : accion.tipo === 'aprobar'
      ? `Aprobar ${accion.club.nombre}`
      : accion.tipo === 'suspender'
        ? `Suspender ${accion.club.nombre}`
        : accion.tipo === 'contrasena'
          ? `Contraseña nueva · ${accion.club.nombre}`
          : accion.tipo === 'especial'
            ? `Precio especial · ${accion.club.nombre}`
            : `Pago del abono · ${accion.club.nombre}`;
  return (
    <Dialogo abierto={accion !== null} alCerrar={alCerrar} titulo={titulo}>
      {accion?.tipo === 'aprobar' ? <FormAprobar club={accion.club} alHacer={alHacer} /> : null}
      {accion?.tipo === 'suspender' ? <FormSuspender club={accion.club} alHacer={alHacer} /> : null}
      {accion?.tipo === 'contrasena' ? <FormContrasena club={accion.club} /> : null}
      {accion?.tipo === 'especial' ? <FormEspecial club={accion.club} alHacer={alHacer} /> : null}
      {accion?.tipo === 'pago' ? <FormPago club={accion.club} alHacer={alHacer} /> : null}
    </Dialogo>
  );
}

/** Link de un solo uso para que el dueño elija una contraseña nueva (se manda por WhatsApp). */
function FormContrasena({ club }: { club: ClubPlataforma }) {
  const generar = useMutation({
    mutationFn: () =>
      panel.post<{ link: string; venceEnMinutos: number }>('/plataforma/restablecer', {
        email: club.dueno?.email,
      }),
  });
  const mensaje = generar.data
    ? `Hola ${club.dueno?.nombre ?? ''}, este es el link para elegir tu contraseña nueva de Canchería (sirve una vez y vence en 1 hora): ${generar.data.link}`
    : '';
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base">
        Genera un link para que <strong>{club.dueno?.email}</strong> elija una contraseña nueva. Sirve una
        sola vez y vence en 1 hora. Mandáselo por un canal privado.
      </p>
      {generar.data ? (
        <>
          <Copiable etiqueta="Link" valor={generar.data.link} />
          {club.telefono ? (
            <a
              href={`${linkWhatsApp(club.telefono)}?text=${encodeURIComponent(mensaje)}`}
              target="_blank"
              rel="noopener"
              className="inline-flex min-h-11 items-center justify-center rounded-xs bg-acento px-4 text-sm font-semibold text-acento-tinta"
            >
              Mandarlo por WhatsApp al club
            </a>
          ) : null}
        </>
      ) : (
        <Boton disabled={generar.isPending} onClick={() => generar.mutate()}>
          Generar link
        </Boton>
      )}
      {generar.error ? <Aviso>{mensajeDe(generar.error)}</Aviso> : null}
    </div>
  );
}

function FormAprobar({ club, alHacer }: { club: ClubPlataforma; alHacer: (m: string) => void }) {
  const qc = useQueryClient();
  const sesion = useSesion();
  const [dias, setDias] = useState(String(sesion.data?.diasPrueba ?? 15));
  const aprobar = useMutation({
    mutationFn: () => panel.post(`/plataforma/clubs/${club.id}/aprobar`, { diasPrueba: Number(dias) || 0 }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plataforma'] });
      alHacer(`${club.nombre} ya toma reservas.`);
    },
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        aprobar.mutate();
      }}
    >
      <p className="text-base">
        Su página <strong>/{club.slug}</strong> empieza a tomar reservas.{' '}
        {club.canchas === 0 ? 'Ojo: todavía no cargó canchas.' : ''}
      </p>
      <Campo
        etiqueta="Días de prueba gratis"
        type="number"
        min={0}
        max={120}
        inputMode="numeric"
        value={dias}
        onChange={(e) => setDias(e.target.value)}
        ayuda="Durante la prueba el abono figura pago. Con 0, empieza debiendo."
      />
      {aprobar.error ? <Aviso>{mensajeDe(aprobar.error)}</Aviso> : null}
      <Boton type="submit" disabled={aprobar.isPending}>
        Aprobar club
      </Boton>
    </form>
  );
}

function FormSuspender({ club, alHacer }: { club: ClubPlataforma; alHacer: (m: string) => void }) {
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState('Abono impago');
  const suspender = useMutation({
    mutationFn: () => panel.post(`/plataforma/clubs/${club.id}/suspender`, { motivo }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plataforma'] });
      alHacer(`${club.nombre} quedó suspendido: su página no toma reservas.`);
    },
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        suspender.mutate();
      }}
    >
      <p className="text-base">
        Su página deja de tomar reservas (los turnos ya tomados se mantienen). El club ve el motivo en su
        panel.
      </p>
      <Campo
        etiqueta="Motivo"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        required
        minLength={3}
      />
      {suspender.error ? <Aviso>{mensajeDe(suspender.error)}</Aviso> : null}
      <Boton type="submit" variante="peligro" disabled={suspender.isPending}>
        Suspender
      </Boton>
    </form>
  );
}

function FormPago({ club, alHacer }: { club: ClubPlataforma; alHacer: (m: string) => void }) {
  const abonoMensual = club.abono?.precio ?? null;
  // Promo pago anual: 12 meses al precio de 10.
  const montoPara = (m: number) => (abonoMensual ? (abonoMensual / 100) * (m === 12 ? 10 : m) : 0);
  const qc = useQueryClient();
  const [meses, setMeses] = useState('1');
  const [monto, setMonto] = useState(abonoMensual ? String(abonoMensual / 100) : '');
  const [medio, setMedio] = useState<keyof typeof MEDIOS>('TRANSFERENCIA');
  const [nota, setNota] = useState('');
  const registrar = useMutation({
    mutationFn: () =>
      panel.post<PagoAbono>(`/plataforma/clubs/${club.id}/pagos`, {
        meses: Number(meses),
        monto: Math.round(Number(monto) * 100),
        medio,
        ...(nota.trim() ? { nota: nota.trim() } : {}),
      }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['plataforma'] });
      alHacer(`Pago registrado: ${club.nombre} tiene el abono cubierto hasta el ${fechaCorta(p.hasta)}.`);
    },
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        registrar.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Selector
          etiqueta="Meses que paga"
          value={meses}
          onChange={(e) => {
            setMeses(e.target.value);
            if (abonoMensual) setMonto(String(montoPara(Number(e.target.value))));
          }}
        >
          {[1, 2, 3, 6, 12].map((m) => (
            <option key={m} value={m}>
              {m} {m === 1 ? 'mes' : 'meses'}
              {m === 12 ? ' (anual: paga 10)' : ''}
            </option>
          ))}
        </Selector>
        <Campo
          etiqueta="Monto ($)"
          type="number"
          min={0}
          inputMode="numeric"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          required
        />
      </div>
      <Selector
        etiqueta="Medio"
        value={medio}
        onChange={(e) => setMedio(e.target.value as keyof typeof MEDIOS)}
      >
        {Object.entries(MEDIOS).map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </Selector>
      <Campo etiqueta="Nota (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} />
      <p className="text-sm text-tenue">
        {club.abonoHasta && club.abonoHasta >= new Date().toISOString().slice(0, 10)
          ? `Se suma después del ${fechaCorta(club.abonoHasta)}, el último día cubierto.`
          : 'Cubre desde hoy.'}
      </p>
      {registrar.error ? <Aviso>{mensajeDe(registrar.error)}</Aviso> : null}
      <Boton type="submit" disabled={registrar.isPending}>
        Registrar pago
      </Boton>
    </form>
  );
}

/** Planes del abono según las canchas activas: el precio de cada club sale de acá. */
function EditorPlanes({ alGuardar }: { alGuardar: (m: string) => void }) {
  const qc = useQueryClient();
  const datos = useQuery({
    queryKey: ['planes'],
    queryFn: () => panel.get<PlanAbono[]>('/plataforma/planes'),
  });
  const [abierto, setAbierto] = useState(false);
  const [filas, setFilas] = useState<
    { clave: string; nombre: string; desdeCanchas: string; precio: string }[] | null
  >(null);
  const actuales =
    filas ??
    (datos.data ?? []).map((p) => ({
      clave: `plan-${p.desdeCanchas}`,
      nombre: p.nombre,
      desdeCanchas: String(p.desdeCanchas),
      precio: String(p.precio / 100),
    }));
  const guardar = useMutation({
    mutationFn: () =>
      panel.put<PlanAbono[]>('/plataforma/planes', {
        planes: actuales.map((f) => ({
          nombre: f.nombre.trim(),
          desdeCanchas: Number(f.desdeCanchas),
          precio: Math.round(Number(f.precio) * 100),
        })),
      }),
    onSuccess: () => {
      setFilas(null);
      setAbierto(false);
      qc.invalidateQueries({ queryKey: ['planes'] });
      qc.invalidateQueries({ queryKey: ['plataforma'] });
      alGuardar('Planes guardados. Los débitos automáticos se actualizan solos en las próximas horas.');
    },
  });
  const cambiar = (i: number, campo: 'nombre' | 'desdeCanchas' | 'precio', v: string) =>
    setFilas(actuales.map((f, k) => (k === i ? { ...f, [campo]: v } : f)));
  const resumen = (datos.data ?? [])
    .map((p, i, l) => {
      const siguiente = l[i + 1];
      const hasta = siguiente ? siguiente.desdeCanchas - 1 : null;
      const rango =
        hasta === null
          ? `${p.desdeCanchas}+`
          : p.desdeCanchas === hasta
            ? `${hasta}`
            : `${p.desdeCanchas}–${hasta}`;
      return `${p.nombre} (${rango}): ${pesos(p.precio)}`;
    })
    .join(' · ');

  return (
    <Tarjeta className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-bold">Planes del abono</h2>
          <p className="text-sm text-tenue">{resumen || 'Cargando…'}</p>
        </div>
        <Boton variante="secundario" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
          {abierto ? 'Cerrar' : 'Editar precios'}
        </Boton>
      </div>
      {abierto ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            guardar.mutate();
          }}
        >
          <p className="text-sm text-tenue">
            Cada plan vale desde esa cantidad de canchas activas hasta el siguiente. El primero arranca en 1.
            Los precios especiales (descuentos) de cada club se aplican sobre estos.
          </p>
          {actuales.map((f, i) => (
            <div key={f.clave} className="grid grid-cols-[1fr_110px_140px_auto] items-end gap-2">
              <Campo
                etiqueta="Plan"
                value={f.nombre}
                onChange={(e) => cambiar(i, 'nombre', e.target.value)}
                required
              />
              <Campo
                etiqueta="Desde canchas"
                type="number"
                min={1}
                value={f.desdeCanchas}
                onChange={(e) => cambiar(i, 'desdeCanchas', e.target.value)}
                required
              />
              <Campo
                etiqueta="Precio ($/mes)"
                type="number"
                min={0}
                value={f.precio}
                onChange={(e) => cambiar(i, 'precio', e.target.value)}
                required
              />
              <Boton
                variante="fantasma"
                aria-label={`Quitar el plan ${f.nombre}`}
                disabled={actuales.length === 1}
                onClick={() => setFilas(actuales.filter((_, k) => k !== i))}
              >
                Quitar
              </Boton>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Boton
              variante="fantasma"
              onClick={() =>
                setFilas([
                  ...actuales,
                  { clave: `nuevo-${Date.now()}`, nombre: '', desdeCanchas: '', precio: '' },
                ])
              }
            >
              + Agregar plan
            </Boton>
            <Boton type="submit" disabled={guardar.isPending}>
              Guardar planes
            </Boton>
          </div>
          {guardar.error ? <Aviso>{mensajeDe(guardar.error)}</Aviso> : null}
        </form>
      ) : null}
    </Tarjeta>
  );
}

/** Descuento en % o precio fijo para un club (fundador, acuerdo), con vencimiento opcional. */
function FormEspecial({ club, alHacer }: { club: ClubPlataforma; alHacer: (m: string) => void }) {
  const qc = useQueryClient();
  const actual = club.abono?.especial ?? null;
  const [tipo, setTipo] = useState<'pct' | 'fijo'>(actual?.precioFijo != null ? 'fijo' : 'pct');
  const [valor, setValor] = useState(
    actual?.precioFijo != null ? String(actual.precioFijo / 100) : String(actual?.descuentoPct ?? 40),
  );
  const [hasta, setHasta] = useState(actual?.hasta ?? '');
  const [motivo, setMotivo] = useState(actual?.motivo ?? 'Fundador');
  const listo = (m: string) => {
    qc.invalidateQueries({ queryKey: ['plataforma'] });
    alHacer(m);
  };
  const guardar = useMutation({
    mutationFn: () =>
      panel.put(`/plataforma/clubs/${club.id}/precio-especial`, {
        ...(tipo === 'pct'
          ? { descuentoPct: Number(valor) }
          : { precioFijo: Math.round(Number(valor) * 100) }),
        hasta: hasta || null,
        motivo: motivo.trim() || null,
      }),
    onSuccess: () => listo(`Precio especial guardado para ${club.nombre}.`),
  });
  const quitar = useMutation({
    mutationFn: () => panel.borrar(`/plataforma/clubs/${club.id}/precio-especial`),
    onSuccess: () => listo(`${club.nombre} vuelve al precio de su plan.`),
  });
  const lista = club.abono?.precioLista ?? 0;
  const resultado =
    tipo === 'pct'
      ? Math.round((lista * (100 - Number(valor || 0))) / 100 / 100) * 100
      : Math.round(Number(valor || 0) * 100);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        guardar.mutate();
      }}
    >
      <p className="text-sm">
        Plan {club.abono?.plan?.nombre ?? '—'}: <strong>{pesos(lista)}/mes</strong>.
      </p>
      <Segmentado
        etiqueta="Tipo de precio especial"
        valor={tipo}
        onCambio={setTipo}
        opciones={[
          { valor: 'pct', etiqueta: 'Descuento %' },
          { valor: 'fijo', etiqueta: 'Precio fijo' },
        ]}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          etiqueta={tipo === 'pct' ? 'Descuento (%)' : 'Precio ($/mes)'}
          type="number"
          min={tipo === 'pct' ? 1 : 0}
          max={tipo === 'pct' ? 100 : undefined}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          required
        />
        <Campo
          etiqueta="Hasta (opcional)"
          type="date"
          value={hasta}
          onChange={(e) => setHasta(e.target.value)}
          ayuda="Después vuelve solo al precio del plan."
        />
      </div>
      <Campo
        etiqueta="Motivo"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Fundador"
      />
      <p className="text-sm">
        Va a pagar <strong className="cifras">{pesos(resultado)}/mes</strong>
        {hasta ? ` hasta el ${fechaCorta(hasta)}` : ''}.
      </p>
      {guardar.error ? <Aviso>{mensajeDe(guardar.error)}</Aviso> : null}
      {quitar.error ? <Aviso>{mensajeDe(quitar.error)}</Aviso> : null}
      <div className="flex flex-wrap gap-2">
        <Boton type="submit" disabled={guardar.isPending}>
          Guardar
        </Boton>
        {actual ? (
          <Boton variante="peligro" disabled={quitar.isPending} onClick={() => quitar.mutate()}>
            Quitar precio especial
          </Boton>
        ) : null}
      </div>
    </form>
  );
}
