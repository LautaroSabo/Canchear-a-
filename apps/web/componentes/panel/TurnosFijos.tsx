'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { mensajeDe, panel, pedir } from '@/lib/api';
import { fechaCorta, hoyEn, linkWhatsApp, pesos, telefonoLegible } from '@/lib/formato';
import type { ClubPublico, MotivoOmision, OcurrenciaFijo, ResultadoFijo, TurnoFijo } from '@/lib/tipos';
import { Aviso, Boton, Campo, Cargando, Casilla, Selector, Tarjeta } from '../ui';
import { aCentavos, aTextoPesos, DIAS, ORDEN_SEMANA, pesosValidos } from './config/comunes';
import { Dialogo } from './Dialogo';
import { useClubActual } from './sesion';

const FRECUENCIAS = { 1: 'Todas las semanas', 2: 'Cada 2 semanas', 4: 'Cada 4 semanas' } as const;
export const MOTIVOS: Record<MotivoOmision, string> = {
  OCUPADO: 'La cancha ya está tomada',
  CERRADO: 'El club está cerrado en ese horario',
  SIN_TARIFA: 'No hay precio para ese horario',
};

function useRefrescar() {
  const { clubId } = useClubActual();
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['turnos-fijos', clubId] });
    qc.invalidateQueries({ queryKey: ['agenda', clubId] });
  };
}

export function TurnosFijos() {
  const { clubId, zona } = useClubActual();
  const [nuevo, setNuevo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [verTerminados, setVerTerminados] = useState(false);
  const lista = useQuery({
    queryKey: ['turnos-fijos', clubId],
    queryFn: () => panel.get<TurnoFijo[]>(`/clubs/${clubId}/turnos-fijos`),
  });
  const activos = lista.data?.filter((f) => f.activo) ?? [];
  const terminados = lista.data?.filter((f) => !f.activo) ?? [];

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-[40px] leading-none font-bold">Turnos fijos</h1>
        <Boton onClick={() => setNuevo(true)}>+ Nuevo turno fijo</Boton>
      </div>
      <p className="text-sm text-suave">
        Los turnos de cada semana se agendan solos con 8 semanas de anticipación. Si una fecha choca con otra
        reserva o el club cierra, no se pisa nada: queda marcada acá para que la resuelvas. Para saltear una
        sola semana, cancelá ese turno desde la agenda.
      </p>
      {aviso ? <Aviso tipo="ok">{aviso}</Aviso> : null}
      {lista.isPending ? (
        <Cargando />
      ) : lista.isError ? (
        <Aviso>{lista.error.message}</Aviso>
      ) : activos.length === 0 ? (
        <Tarjeta>
          <p className="text-sm">Todavía no hay turnos fijos.</p>
        </Tarjeta>
      ) : (
        ORDEN_SEMANA.filter((d) => activos.some((f) => f.diaSemana === d)).map((d) => (
          <section key={d} aria-label={DIAS[d]} className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold text-suave">{DIAS[d]}</h2>
            {activos
              .filter((f) => f.diaSemana === d)
              .map((f) => (
                <FichaFijo key={f.id} fijo={f} zona={zona} alHacer={setAviso} />
              ))}
          </section>
        ))
      )}
      {terminados.length ? (
        <div>
          <Boton variante="fantasma" onClick={() => setVerTerminados(!verTerminados)}>
            {verTerminados ? 'Ocultar' : 'Ver'} terminados ({terminados.length})
          </Boton>
          {verTerminados ? (
            <ul className="mt-2 flex flex-col gap-1 text-sm text-suave">
              {terminados.map((f) => (
                <li key={f.id}>
                  {DIAS[f.diaSemana]} {f.horaInicio} · {f.cancha} · {f.cliente.nombre}
                  {f.vigenteHasta ? ` · hasta el ${fechaCorta(f.vigenteHasta)}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <Dialogo abierto={nuevo} alCerrar={() => setNuevo(false)} titulo="Nuevo turno fijo">
        {nuevo ? (
          <FormNuevo
            zona={zona}
            alCrear={(r, nombre) => {
              setNuevo(false);
              setAviso(
                `Turno fijo de ${nombre} creado: ${r.creados} ${r.creados === 1 ? 'turno agendado' : 'turnos agendados'}` +
                  (r.omitidos.length ? `, ${r.omitidos.length} con problemas (abajo).` : '.'),
              );
            }}
          />
        ) : null}
      </Dialogo>
    </div>
  );
}

function FichaFijo({
  fijo: f,
  zona,
  alHacer,
}: {
  fijo: TurnoFijo;
  zona: string;
  alHacer: (m: string) => void;
}) {
  const { clubId } = useClubActual();
  const refrescar = useRefrescar();
  const [dialogo, setDialogo] = useState<'precio' | 'baja' | null>(null);
  const reintentar = useMutation({
    mutationFn: (fecha: string) =>
      panel.post<{ creado: boolean; motivo: MotivoOmision | null }>(
        `/clubs/${clubId}/turnos-fijos/${f.id}/omitidos/${fecha}/reintentar`,
      ),
    onSuccess: (r, fecha) => {
      refrescar();
      alHacer(
        r.creado
          ? `Listo: quedó agendado el ${fechaCorta(fecha)}.`
          : `Sigue sin poder agendarse: ${MOTIVOS[r.motivo ?? 'OCUPADO'].toLowerCase()}.`,
      );
    },
  });
  const descartar = useMutation({
    mutationFn: (fecha: string) => panel.borrar(`/clubs/${clubId}/turnos-fijos/${f.id}/omitidos/${fecha}`),
    onSuccess: refrescar,
  });

  return (
    <Tarjeta className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold">
            {f.horaInicio} · {f.cancha} · {f.cliente.nombre}
          </div>
          <div className="text-sm text-medio">
            {FRECUENCIAS[f.frecuenciaSemanas]} · {f.duracionMin} min ·{' '}
            {f.precioPactado === null ? 'precio de la tarifa' : `${pesos(f.precioPactado)} pactado`}
            {f.vigenteHasta ? ` · hasta el ${fechaCorta(f.vigenteHasta)}` : ''}
          </div>
          <div className="text-sm text-medio">
            <a href={linkWhatsApp(f.cliente.telefono)} className="font-semibold text-cancha">
              {telefonoLegible(f.cliente.telefono)}
            </a>
            {f.proximo ? ` · próximo: ${fechaCorta(hoyEn(zona, new Date(f.proximo)))}` : ''}
          </div>
          {f.nota ? <div className="mt-1 text-sm">Nota: {f.nota}</div> : null}
        </div>
        <div className="flex gap-1">
          <Boton variante="fantasma" onClick={() => setDialogo('precio')}>
            Precio
          </Boton>
          <Boton variante="fantasma" onClick={() => setDialogo('baja')}>
            Dar de baja
          </Boton>
        </div>
      </div>
      {f.omitidos.length ? (
        <ul
          className="flex flex-col gap-2 rounded-xs bg-ambar-fondo p-3 text-sm text-ambar-texto"
          aria-label="Fechas sin agendar"
        >
          {f.omitidos.map((o) => (
            <li key={o.fecha} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>{fechaCorta(o.fecha)}</strong>: {MOTIVOS[o.motivo]}
                {o.conflicto ? ` (${o.conflicto})` : ''}
              </span>
              <span className="flex gap-1">
                <Boton
                  variante="secundario"
                  disabled={reintentar.isPending}
                  onClick={() => reintentar.mutate(o.fecha)}
                >
                  Reintentar
                </Boton>
                <Boton
                  variante="fantasma"
                  disabled={descartar.isPending}
                  onClick={() => descartar.mutate(o.fecha)}
                >
                  Ya lo resolví
                </Boton>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {reintentar.error || descartar.error ? (
        <Aviso>{mensajeDe(reintentar.error ?? descartar.error)}</Aviso>
      ) : null}
      <Dialogo
        abierto={dialogo === 'precio'}
        alCerrar={() => setDialogo(null)}
        titulo="Precio del turno fijo"
      >
        {dialogo === 'precio' ? (
          <FormPrecio
            fijo={f}
            alGuardar={(n) => {
              setDialogo(null);
              alHacer(`Precio actualizado${n ? ` en ${n} turnos ya agendados` : ''}.`);
            }}
          />
        ) : null}
      </Dialogo>
      <Dialogo
        abierto={dialogo === 'baja'}
        alCerrar={() => setDialogo(null)}
        titulo="Dar de baja el turno fijo"
      >
        {dialogo === 'baja' ? (
          <FormBaja
            fijo={f}
            zona={zona}
            alTerminar={(m) => {
              setDialogo(null);
              alHacer(m);
            }}
          />
        ) : null}
      </Dialogo>
    </Tarjeta>
  );
}

function FormPrecio({ fijo, alGuardar }: { fijo: TurnoFijo; alGuardar: (actualizados: number) => void }) {
  const { clubId } = useClubActual();
  const refrescar = useRefrescar();
  const [tarifa, setTarifa] = useState(fijo.precioPactado === null);
  const [precio, setPrecio] = useState(fijo.precioPactado === null ? '' : aTextoPesos(fijo.precioPactado));
  const guardar = useMutation({
    mutationFn: () =>
      panel.patch<{ actualizados: number }>(`/clubs/${clubId}/turnos-fijos/${fijo.id}`, {
        precioPactado: tarifa ? null : aCentavos(precio),
      }),
    onSuccess: (r) => {
      refrescar();
      alGuardar(r.actualizados);
    },
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (tarifa || pesosValidos(precio)) guardar.mutate();
      }}
    >
      <Casilla
        etiqueta="Usar la tarifa del club"
        checked={tarifa}
        onChange={(e) => setTarifa(e.target.checked)}
      />
      {tarifa ? null : (
        <Campo
          etiqueta="Precio pactado por turno ($)"
          inputMode="decimal"
          value={precio}
          onChange={(e) => setPrecio(e.target.value)}
          required
        />
      )}
      <p className="text-sm text-suave">Se aplica también a los turnos ya agendados que no tienen pagos.</p>
      {guardar.error ? <Aviso>{mensajeDe(guardar.error)}</Aviso> : null}
      <Boton type="submit" disabled={guardar.isPending}>
        Guardar precio
      </Boton>
    </form>
  );
}

function FormBaja({
  fijo,
  zona,
  alTerminar,
}: {
  fijo: TurnoFijo;
  zona: string;
  alTerminar: (m: string) => void;
}) {
  const { clubId } = useClubActual();
  const refrescar = useRefrescar();
  const [desde, setDesde] = useState(hoyEn(zona));
  const baja = useMutation({
    mutationFn: () =>
      panel.post<{ cancelados: number; conPagos: number }>(`/clubs/${clubId}/turnos-fijos/${fijo.id}/baja`, {
        desde,
      }),
    onSuccess: (r) => {
      refrescar();
      alTerminar(
        `Turno fijo de ${fijo.cliente.nombre} dado de baja. Se liberaron ${r.cancelados} turnos.` +
          (r.conPagos
            ? ` ${r.conPagos} con pagos quedaron en la agenda: cancelalos desde ahí si corresponde.`
            : ''),
      );
    },
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        baja.mutate();
      }}
    >
      <p className="text-sm">
        {fijo.cliente.nombre} · {DIAS[fijo.diaSemana]} {fijo.horaInicio} · {fijo.cancha}
      </p>
      <Campo
        etiqueta="Deja de venir desde"
        type="date"
        min={hoyEn(zona)}
        value={desde}
        onChange={(e) => setDesde(e.target.value)}
        required
        ayuda="Los turnos agendados desde esa fecha se cancelan y se le ofrecen a la lista de espera. No se le avisa al cliente."
      />
      {baja.error ? <Aviso>{mensajeDe(baja.error)}</Aviso> : null}
      <Boton type="submit" variante="peligro" disabled={baja.isPending}>
        Dar de baja
      </Boton>
    </form>
  );
}

function FormNuevo({ zona, alCrear }: { zona: string; alCrear: (r: ResultadoFijo, nombre: string) => void }) {
  const { clubId, club } = useClubActual();
  const refrescar = useRefrescar();
  const publico = useQuery({
    queryKey: ['club', club?.slug],
    queryFn: () => pedir<ClubPublico>(`/public/clubs/${club?.slug}`),
    enabled: Boolean(club?.slug),
  });
  const canchas = publico.data?.canchas ?? [];
  const [f, setF] = useState({
    canchaId: '',
    diaSemana: '',
    horaInicio: '',
    frecuenciaSemanas: '1',
    vigenteDesde: hoyEn(zona),
    vigenteHasta: '',
    pactado: false,
    precio: '',
    nombre: '',
    telefono: '',
    nota: '',
    notificar: true,
  });
  useEffect(() => {
    if (!f.canchaId && canchas[0]) setF((x) => ({ ...x, canchaId: canchas[0]?.id ?? '' }));
  }, [canchas, f.canchaId]);

  const plantilla = {
    canchaId: f.canchaId,
    diaSemana: Number(f.diaSemana),
    horaInicio: f.horaInicio,
    frecuenciaSemanas: Number(f.frecuenciaSemanas),
    vigenteDesde: f.vigenteDesde,
    vigenteHasta: f.vigenteHasta || null,
    precioPactado: f.pactado && pesosValidos(f.precio) ? aCentavos(f.precio) : null,
  };
  const completa = Boolean(
    f.canchaId && f.diaSemana !== '' && /^\d\d:\d\d$/.test(f.horaInicio) && f.vigenteDesde,
  );
  const previa = useQuery({
    queryKey: ['previa-fijo', clubId, plantilla],
    queryFn: () =>
      panel.post<{ vigenteDesde: string; ocurrencias: OcurrenciaFijo[] }>(
        `/clubs/${clubId}/turnos-fijos/previsualizar`,
        plantilla,
      ),
    enabled: completa,
  });
  const crear = useMutation({
    mutationFn: () =>
      panel.post<ResultadoFijo>(`/clubs/${clubId}/turnos-fijos`, {
        ...plantilla,
        cliente: { nombre: f.nombre.trim(), telefono: f.telefono.trim() },
        nota: f.nota.trim() || null,
        notificar: f.notificar,
      }),
    onSuccess: (r) => {
      refrescar();
      alCrear(r, f.nombre.trim());
    },
  });
  const problemas = previa.data?.ocurrencias.filter((o) => o.estado !== 'LIBRE') ?? [];

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        crear.mutate();
      }}
    >
      <Selector
        etiqueta="Cancha"
        value={f.canchaId}
        onChange={(e) => setF({ ...f, canchaId: e.target.value })}
        required
      >
        {canchas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </Selector>
      <Selector
        etiqueta="Día"
        value={f.diaSemana}
        onChange={(e) => setF({ ...f, diaSemana: e.target.value })}
        required
      >
        <option value="" disabled>
          Elegí el día
        </option>
        {ORDEN_SEMANA.map((d) => (
          <option key={d} value={d}>
            {DIAS[d]}
          </option>
        ))}
      </Selector>
      <Campo
        etiqueta="Hora"
        type="time"
        step={1800}
        value={f.horaInicio}
        onChange={(e) => setF({ ...f, horaInicio: e.target.value })}
        required
      />
      <Selector
        etiqueta="Frecuencia"
        value={f.frecuenciaSemanas}
        onChange={(e) => setF({ ...f, frecuenciaSemanas: e.target.value })}
      >
        {Object.entries(FRECUENCIAS).map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </Selector>
      <Campo
        etiqueta="Desde"
        type="date"
        min={hoyEn(zona)}
        value={f.vigenteDesde}
        onChange={(e) => setF({ ...f, vigenteDesde: e.target.value })}
        required
      />
      <Campo
        etiqueta="Hasta (opcional)"
        type="date"
        value={f.vigenteHasta}
        onChange={(e) => setF({ ...f, vigenteHasta: e.target.value })}
      />
      <Campo
        etiqueta="Nombre del cliente o equipo"
        value={f.nombre}
        maxLength={80}
        onChange={(e) => setF({ ...f, nombre: e.target.value })}
        required
      />
      <Campo
        etiqueta="WhatsApp"
        type="tel"
        value={f.telefono}
        onChange={(e) => setF({ ...f, telefono: e.target.value })}
        required
      />
      <div className="sm:col-span-2">
        <Casilla
          etiqueta="Precio pactado (si no, se cobra la tarifa de cada fecha)"
          checked={f.pactado}
          onChange={(e) => setF({ ...f, pactado: e.target.checked })}
        />
      </div>
      {f.pactado ? (
        <Campo
          etiqueta="Precio por turno ($)"
          inputMode="decimal"
          value={f.precio}
          onChange={(e) => setF({ ...f, precio: e.target.value })}
          required
        />
      ) : null}
      <div className="sm:col-span-2">
        <Campo
          etiqueta="Nota interna (opcional)"
          value={f.nota}
          maxLength={500}
          placeholder="Pagan por mes, equipo de la empresa…"
          onChange={(e) => setF({ ...f, nota: e.target.value })}
        />
      </div>
      <div className="sm:col-span-2">
        <Casilla
          etiqueta="Avisarle por WhatsApp"
          checked={f.notificar}
          onChange={(e) => setF({ ...f, notificar: e.target.checked })}
        />
      </div>

      <section
        aria-label="Próximas fechas"
        className="flex flex-col gap-1.5 rounded-xs bg-fondo p-3 text-sm sm:col-span-2"
      >
        {!completa ? (
          <span className="text-suave">Elegí cancha, día y hora para ver las fechas.</span>
        ) : previa.isPending ? (
          <Cargando texto="Revisando la agenda…" />
        ) : previa.isError ? (
          <Aviso>{mensajeDe(previa.error)}</Aviso>
        ) : (
          <>
            <strong>
              {previa.data.ocurrencias.length - problemas.length} de {previa.data.ocurrencias.length} fechas
              libres en las próximas 8 semanas
            </strong>
            {problemas.map((o) => (
              <span key={o.fecha} className="text-ambar-texto">
                {fechaCorta(o.fecha)}: {MOTIVOS[o.estado as MotivoOmision]}
                {o.conflicto ? ` (${o.conflicto.cliente ?? 'bloqueo'})` : ''}
              </span>
            ))}
            {problemas.length ? (
              <span className="text-suave">
                Esas fechas no se agendan; las vas a ver marcadas para resolverlas.
              </span>
            ) : null}
            {previa.data.ocurrencias[0]?.precio != null ? (
              <span className="text-suave">
                Primera fecha: {fechaCorta(previa.data.ocurrencias[0].fecha)} ·{' '}
                {pesos(previa.data.ocurrencias[0].precio)}
              </span>
            ) : null}
          </>
        )}
      </section>
      {crear.error ? (
        <div className="sm:col-span-2">
          <Aviso>{mensajeDe(crear.error)}</Aviso>
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <Boton type="submit" className="w-full" disabled={crear.isPending || !completa}>
          Crear turno fijo
        </Boton>
      </div>
    </form>
  );
}
