'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorApi, mensajeDe, panel } from '@/lib/api';
import { fechaCorta, hora, instanteLocal, pesos } from '@/lib/formato';
import type { Agenda, DetalleTurno, ResumenCobro } from '@/lib/tipos';
import { uuid } from '@/lib/uuid';
import { Aviso, Boton, Campo } from '../ui';
import { Dialogo } from './Dialogo';
import { useClubActual } from './sesion';

const claseSelect = 'min-h-11 rounded-xl border border-[#c9d1cb] bg-white px-3 text-base font-normal';

export interface Prefill {
  canchaId: string;
  hora: string;
  fecha?: string;
}

/** "45000" o "45.000" (pesos) → centavos. */
const aCentavos = (texto: string) => Math.round(Number(texto.replace(/\./g, '').replace(',', '.')) * 100);

export function DialogoNuevo({
  prefill,
  agenda,
  alCerrar,
  alCrear,
}: {
  prefill: Prefill | null;
  agenda: Agenda;
  alCerrar: () => void;
  alCrear: (mensaje: string) => void;
}) {
  return (
    <Dialogo abierto={Boolean(prefill)} alCerrar={alCerrar} titulo="Nuevo turno">
      {prefill ? (
        <FormNuevo
          key={`${prefill.canchaId}${prefill.hora}`}
          prefill={prefill}
          agenda={agenda}
          alCrear={alCrear}
        />
      ) : null}
    </Dialogo>
  );
}

function FormNuevo({
  prefill,
  agenda,
  alCrear,
}: {
  prefill: Prefill;
  agenda: Agenda;
  alCrear: (m: string) => void;
}) {
  const { clubId } = useClubActual();
  const cancha0 = agenda.canchas.find((c) => c.id === prefill.canchaId) ?? agenda.canchas[0];
  const [f, setF] = useState({
    tipo: 'turno' as 'turno' | 'bloqueo',
    canchaId: cancha0?.id ?? '',
    fecha: prefill.fecha ?? agenda.fecha,
    hora: prefill.hora,
    duracion: String(cancha0?.duracionMin ?? 60),
    nombre: '',
    telefono: '',
    precio: '',
    nota: '',
    notificar: true,
  });
  const [idem] = useState(uuid);
  const crear = useMutation({
    mutationFn: () => {
      const inicio = instanteLocal(f.fecha, f.hora, agenda.zonaHoraria);
      const fin = new Date(Date.parse(inicio) + Number(f.duracion) * 60_000).toISOString();
      if (f.tipo === 'bloqueo') {
        return panel.post(`/clubs/${clubId}/bloqueos`, {
          canchaId: f.canchaId,
          inicio,
          fin,
          motivo: f.nota.trim(),
        });
      }
      return panel.post<DetalleTurno>(`/clubs/${clubId}/turnos`, {
        canchaId: f.canchaId,
        inicio,
        fin,
        cliente: { nombre: f.nombre.trim(), telefono: f.telefono.trim() },
        ...(f.precio.trim() ? { precio: aCentavos(f.precio) } : {}),
        ...(f.nota.trim() ? { nota: f.nota.trim() } : {}),
        notificar: f.notificar,
        idempotencyKey: idem,
      });
    },
    onSuccess: (r) => {
      if (f.tipo === 'bloqueo' || !r) return alCrear('Cancha bloqueada.');
      // El teléfono identifica al cliente: si ya existía, el turno queda a su nombre de siempre.
      const nombre = (r as DetalleTurno).cliente?.nombre ?? f.nombre.trim();
      const existente = nombre.toLowerCase() !== f.nombre.trim().toLowerCase();
      alCrear(
        `Turno cargado para ${nombre}${existente ? ' (ese WhatsApp ya era de este cliente)' : ''}.${
          f.notificar ? ' Le mandamos el comprobante por WhatsApp.' : ''
        }`,
      );
    },
  });
  const conflictos =
    crear.error instanceof ErrorApi && crear.error.codigo === 'TURNO_OCUPADO'
      ? ((crear.error.detalle as { conflictos?: { cliente: string | null; inicio: string; fin: string }[] })
          ?.conflictos ?? [])
      : [];

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        crear.mutate();
      }}
    >
      <fieldset className="flex min-w-0 gap-1 rounded-xl bg-[#eef1ee] p-1">
        <legend className="sr-only">Tipo</legend>
        {(['turno', 'bloqueo'] as const).map((tipo) => (
          <button
            key={tipo}
            type="button"
            aria-pressed={f.tipo === tipo}
            onClick={() => setF({ ...f, tipo })}
            className={`min-h-10 flex-1 rounded-lg text-sm font-semibold ${f.tipo === tipo ? 'bg-white shadow-sm' : 'text-medio'}`}
          >
            {tipo === 'turno' ? 'Turno para un cliente' : 'Bloquear la cancha'}
          </button>
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Cancha
          <select
            className={claseSelect}
            value={f.canchaId}
            onChange={(e) => setF({ ...f, canchaId: e.target.value })}
          >
            {agenda.canchas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <Campo
          etiqueta="Día"
          type="date"
          value={f.fecha}
          onChange={(e) => setF({ ...f, fecha: e.target.value })}
          required
        />
        <Campo
          etiqueta="Desde"
          type="time"
          step={1800}
          value={f.hora}
          onChange={(e) => setF({ ...f, hora: e.target.value })}
          required
        />
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Duración
          <select
            className={claseSelect}
            value={f.duracion}
            onChange={(e) => setF({ ...f, duracion: e.target.value })}
          >
            {[60, 90, 120, 180, 240].map((m) => (
              <option key={m} value={m}>
                {m < 120 ? `${m} min` : `${m / 60} h`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {f.tipo === 'turno' ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Campo
              etiqueta="Nombre"
              value={f.nombre}
              onChange={(e) => setF({ ...f, nombre: e.target.value })}
              required
              minLength={2}
            />
            <Campo
              etiqueta="WhatsApp"
              type="tel"
              value={f.telefono}
              onChange={(e) => setF({ ...f, telefono: e.target.value })}
              required
            />
          </div>
          <Campo
            etiqueta="Precio (opcional)"
            inputMode="decimal"
            placeholder="Si lo dejás vacío se usa la tarifa"
            value={f.precio}
            onChange={(e) => setF({ ...f, precio: e.target.value })}
          />
          <Campo
            etiqueta="Nota interna (opcional)"
            value={f.nota}
            onChange={(e) => setF({ ...f, nota: e.target.value })}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={f.notificar}
              onChange={(e) => setF({ ...f, notificar: e.target.checked })}
            />
            Mandarle el comprobante con el QR por WhatsApp
          </label>
        </>
      ) : (
        <Campo
          etiqueta="Motivo"
          placeholder="Mantenimiento, evento…"
          value={f.nota}
          onChange={(e) => setF({ ...f, nota: e.target.value })}
          required
          minLength={2}
        />
      )}
      {crear.error ? (
        <Aviso>
          {mensajeDe(crear.error)}
          {conflictos.length ? (
            <ul className="mt-1 list-disc pl-5">
              {conflictos.map((c) => (
                <li key={c.inicio}>
                  {c.cliente ?? 'Bloqueo'} · {hora(c.inicio, agenda.zonaHoraria)} a{' '}
                  {hora(c.fin, agenda.zonaHoraria)}
                </li>
              ))}
            </ul>
          ) : null}
        </Aviso>
      ) : null}
      <Boton type="submit" grande disabled={crear.isPending}>
        {crear.isPending
          ? 'Guardando…'
          : f.tipo === 'bloqueo'
            ? 'Bloquear'
            : `Cargar turno · ${fechaCorta(f.fecha)} ${f.hora}`}
      </Boton>
    </form>
  );
}

export function DialogoCobrar({
  abierto,
  turno,
  alCerrar,
  alCobrar,
}: {
  abierto: boolean;
  turno: DetalleTurno;
  alCerrar: () => void;
  alCobrar: (mensaje: string) => void;
}) {
  const esSena = turno.estado === 'PRE_RESERVADO';
  return (
    <Dialogo abierto={abierto} alCerrar={alCerrar} titulo={esSena ? 'Cobrar la seña' : 'Cobrar el saldo'}>
      {abierto ? <FormCobrar turno={turno} esSena={esSena} alCobrar={alCobrar} /> : null}
    </Dialogo>
  );
}

function FormCobrar({
  turno,
  esSena,
  alCobrar,
}: {
  turno: DetalleTurno;
  esSena: boolean;
  alCobrar: (m: string) => void;
}) {
  const { clubId } = useClubActual();
  const [monto, setMonto] = useState(String(Math.round((esSena ? turno.montoSena : turno.saldo) / 100)));
  const [medio, setMedio] = useState<'EFECTIVO' | 'TRANSFERENCIA' | 'OTRO'>('EFECTIVO');
  const cobrar = useMutation({
    mutationFn: () =>
      panel.post<ResumenCobro>(`/clubs/${clubId}/turnos/${turno.id}/pagos`, {
        monto: aCentavos(monto),
        medio,
        concepto: esSena ? 'SENA' : 'SALDO',
      }),
    onSuccess: (r) =>
      alCobrar(
        esSena
          ? 'Seña cobrada: turno confirmado y aviso enviado al cliente.'
          : `Cobrado. Saldo pendiente: ${pesos(r.saldo)}.`,
      ),
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        cobrar.mutate();
      }}
    >
      <Campo
        etiqueta="Monto ($)"
        inputMode="decimal"
        value={monto}
        onChange={(e) => setMonto(e.target.value)}
        required
      />
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Medio
        <select
          className={claseSelect}
          value={medio}
          onChange={(e) => setMedio(e.target.value as typeof medio)}
        >
          <option value="EFECTIVO">Efectivo</option>
          <option value="TRANSFERENCIA">Transferencia (mostrada en el celular)</option>
          <option value="OTRO">Otro (posnet, QR)</option>
        </select>
      </label>
      {cobrar.error ? <Aviso>{mensajeDe(cobrar.error)}</Aviso> : null}
      <Boton type="submit" grande disabled={cobrar.isPending || !(aCentavos(monto) > 0)}>
        {cobrar.isPending ? 'Registrando…' : `Registrar cobro de $${monto || 0}`}
      </Boton>
    </form>
  );
}

export function DialogoCancelar({
  abierto,
  turno,
  alCerrar,
  alCancelar,
}: {
  abierto: boolean;
  turno: DetalleTurno;
  alCerrar: () => void;
  alCancelar: (mensaje: string) => void;
}) {
  return (
    <Dialogo
      abierto={abierto}
      alCerrar={alCerrar}
      titulo={turno.origen === 'BLOQUEO' ? 'Quitar bloqueo' : 'Cancelar turno'}
    >
      {abierto ? <FormCancelar turno={turno} alCancelar={alCancelar} /> : null}
    </Dialogo>
  );
}

function FormCancelar({ turno, alCancelar }: { turno: DetalleTurno; alCancelar: (m: string) => void }) {
  const { clubId } = useClubActual();
  const esBloqueo = turno.origen === 'BLOQUEO';
  const [motivo, setMotivo] = useState(esBloqueo ? 'Bloqueo quitado' : '');
  const [devolver, setDevolver] = useState(true);
  const [notificar, setNotificar] = useState(true);
  const conSena = turno.pagos.some((p) => p.concepto === 'SENA' && p.estado === 'APROBADO');
  const cancelar = useMutation({
    mutationFn: () =>
      panel.post<{ senaADevolver: number; ofertaListaEspera: string | null }>(
        `/clubs/${clubId}/turnos/${turno.id}/cancelar`,
        {
          motivo: motivo.trim(),
          devolverSena: conSena && devolver,
          notificar,
        },
      ),
    onSuccess: (r) =>
      alCancelar(
        esBloqueo
          ? 'Bloqueo quitado: la cancha vuelve a estar disponible.'
          : [
              'Turno cancelado.',
              notificar ? 'Le avisamos al cliente por WhatsApp.' : '',
              r.senaADevolver > 0 ? `Seña a devolver: ${pesos(r.senaADevolver)}.` : '',
              r.ofertaListaEspera ? 'El horario se le ofreció a la lista de espera.' : '',
            ]
              .filter(Boolean)
              .join(' '),
      ),
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        cancelar.mutate();
      }}
    >
      {!esBloqueo ? (
        <>
          <p className="text-sm text-medio">
            {turno.cliente?.nombre} · {turno.cancha}
          </p>
          <Campo
            etiqueta="Motivo"
            placeholder="Lluvia, pedido del cliente…"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            required
            minLength={2}
          />
          {conSena ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={devolver}
                onChange={(e) => setDevolver(e.target.checked)}
              />
              Devolver la seña
            </label>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={notificar}
              onChange={(e) => setNotificar(e.target.checked)}
            />
            Avisarle al cliente por WhatsApp
          </label>
        </>
      ) : (
        <p className="text-sm text-medio">La cancha vuelve a quedar disponible para reservar.</p>
      )}
      {cancelar.error ? <Aviso>{mensajeDe(cancelar.error)}</Aviso> : null}
      <Boton type="submit" variante="peligro" grande disabled={cancelar.isPending}>
        {cancelar.isPending ? 'Cancelando…' : esBloqueo ? 'Quitar bloqueo' : 'Cancelar turno'}
      </Boton>
    </form>
  );
}
