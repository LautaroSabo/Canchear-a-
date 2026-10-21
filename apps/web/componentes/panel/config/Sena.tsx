'use client';

import { useState } from 'react';
import { mensajeDe, panel } from '@/lib/api';
import { pesos } from '@/lib/formato';
import type { CanchaConfig, ReglaSena } from '@/lib/tipos';
import { Aviso, Boton, Campo, Casilla, Selector, Tarjeta } from '../../ui';
import { Dialogo } from '../Dialogo';
import { aCentavos, aTextoPesos, DIAS, franjaTexto, ORDEN_SEMANA, pesosValidos, useGuardar } from './comunes';

export function Sena({ reglas, canchas }: { reglas: ReglaSena[]; canchas: CanchaConfig[] }) {
  const [editando, setEditando] = useState<ReglaSena | 'nueva' | null>(null);
  const borrar = useGuardar((clubId, id: string) => panel.borrar(`/clubs/${clubId}/config/reglas/${id}`));
  const activar = useGuardar((clubId, r: ReglaSena) => {
    const { id, ...datos } = r;
    return panel.put(`/clubs/${clubId}/config/reglas/${id}`, { ...datos, activa: !r.activa });
  });
  const nombreCancha = (id: string | null) => canchas.find((c) => c.id === id)?.nombre;

  return (
    <Tarjeta className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Seña y tiempo para pagar</h2>
        <Boton variante="secundario" onClick={() => setEditando('nueva')}>
          Agregar regla
        </Boton>
      </div>
      <p className="text-sm text-suave">
        Cuando alguien reserva, el turno queda apartado mientras paga la seña. Cada regla define si se pide
        seña, cuánto, y cuántos minutos tiene para pagar. Si varias aplican, gana la de mayor prioridad.
      </p>
      {borrar.error || activar.error ? <Aviso>{mensajeDe(borrar.error ?? activar.error)}</Aviso> : null}
      <ul className="flex flex-col divide-y divide-linea">
        {reglas.map((r) => (
          <li
            key={r.id}
            className={`flex flex-wrap items-center justify-between gap-2 py-3 ${r.activa ? '' : 'text-suave'}`}
          >
            <div>
              <div className="font-bold">
                {r.nombre}
                <span className="ml-2 rounded-full bg-fondo px-2 py-0.5 text-xs font-semibold">
                  prioridad {r.prioridad}
                </span>
                {r.activa ? null : (
                  <span className="ml-1 rounded-full bg-fondo px-2 py-0.5 text-xs font-semibold">
                    Pausada
                  </span>
                )}
              </div>
              <div className="text-sm text-medio">
                {[
                  nombreCancha(r.canchaId) ?? 'Todas las canchas',
                  r.diaSemana === null ? 'todos los días' : DIAS[r.diaSemana]?.toLowerCase(),
                  franjaTexto(r.horaDesde, r.horaHasta).toLowerCase(),
                ].join(' · ')}
              </div>
              <div className="text-sm">
                {r.requiereSena
                  ? `Seña de ${r.tipoSena === 'PORCENTAJE' ? `${r.valorSena}%` : pesos(r.valorSena)} · ${r.minutosExpiracion} min para pagar`
                  : 'Sin seña: se confirma al reservar'}
              </div>
            </div>
            <div className="flex gap-2">
              <Boton variante="fantasma" onClick={() => setEditando(r)}>
                Editar
              </Boton>
              <Boton variante="fantasma" disabled={activar.isPending} onClick={() => activar.mutate(r)}>
                {r.activa ? 'Pausar' : 'Activar'}
              </Boton>
              <Boton variante="fantasma" disabled={borrar.isPending} onClick={() => borrar.mutate(r.id)}>
                Borrar
              </Boton>
            </div>
          </li>
        ))}
      </ul>
      <Dialogo
        abierto={editando !== null}
        alCerrar={() => setEditando(null)}
        titulo={editando === 'nueva' ? 'Nueva regla de seña' : 'Editar regla de seña'}
      >
        {editando ? (
          <FormRegla
            regla={editando === 'nueva' ? null : editando}
            canchas={canchas}
            alGuardar={() => setEditando(null)}
          />
        ) : null}
      </Dialogo>
    </Tarjeta>
  );
}

function FormRegla({
  regla,
  canchas,
  alGuardar,
}: {
  regla: ReglaSena | null;
  canchas: CanchaConfig[];
  alGuardar: () => void;
}) {
  const [f, setF] = useState({
    nombre: regla?.nombre ?? '',
    canchaId: regla?.canchaId ?? '',
    diaSemana: regla?.diaSemana === null || !regla ? '' : String(regla.diaSemana),
    todoElDia: !regla?.horaDesde,
    horaDesde: regla?.horaDesde ?? '18:00',
    horaHasta: regla?.horaHasta ?? '00:00',
    requiereSena: regla?.requiereSena ?? true,
    tipoSena: regla?.tipoSena ?? 'PORCENTAJE',
    valor: regla?.tipoSena === 'MONTO_FIJO' ? aTextoPesos(regla.valorSena) : String(regla?.valorSena ?? 50),
    minutosExpiracion: String(regla?.minutosExpiracion ?? 30),
    margenMinAntesInicio: String(regla?.margenMinAntesInicio ?? 15),
    prioridad: String(regla?.prioridad ?? 10),
    activa: regla?.activa ?? true,
  });
  const valorOk =
    !f.requiereSena ||
    (f.tipoSena === 'PORCENTAJE'
      ? /^\d{1,3}$/.test(f.valor) && Number(f.valor) <= 100
      : pesosValidos(f.valor));
  const guardar = useGuardar((clubId) => {
    const cuerpo = {
      nombre: f.nombre.trim(),
      canchaId: f.canchaId || null,
      diaSemana: f.diaSemana === '' ? null : Number(f.diaSemana),
      horaDesde: f.todoElDia ? null : f.horaDesde,
      horaHasta: f.todoElDia ? null : f.horaHasta,
      requiereSena: f.requiereSena,
      tipoSena: f.tipoSena,
      valorSena: !f.requiereSena ? 0 : f.tipoSena === 'PORCENTAJE' ? Number(f.valor) : aCentavos(f.valor),
      minutosExpiracion: Number(f.minutosExpiracion),
      margenMinAntesInicio: Number(f.margenMinAntesInicio),
      prioridad: Number(f.prioridad),
      activa: f.activa,
    };
    return regla
      ? panel.put(`/clubs/${clubId}/config/reglas/${regla.id}`, cuerpo)
      : panel.post(`/clubs/${clubId}/config/reglas`, cuerpo);
  }, alGuardar);

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valorOk) guardar.mutate();
      }}
    >
      <div className="sm:col-span-2">
        <Campo
          etiqueta="Nombre"
          placeholder="Fin de semana noche"
          maxLength={60}
          value={f.nombre}
          onChange={(e) => setF({ ...f, nombre: e.target.value })}
          required
        />
      </div>
      <Selector
        etiqueta="Cancha"
        value={f.canchaId}
        onChange={(e) => setF({ ...f, canchaId: e.target.value })}
      >
        <option value="">Todas las canchas</option>
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
      >
        <option value="">Todos los días</option>
        {ORDEN_SEMANA.map((d) => (
          <option key={d} value={d}>
            {DIAS[d]}
          </option>
        ))}
      </Selector>
      <div className="sm:col-span-2">
        <Casilla
          etiqueta="Todo el día"
          checked={f.todoElDia}
          onChange={(e) => setF({ ...f, todoElDia: e.target.checked })}
        />
      </div>
      {f.todoElDia ? null : (
        <>
          <Campo
            etiqueta="Turnos que empiezan desde"
            type="time"
            value={f.horaDesde}
            onChange={(e) => setF({ ...f, horaDesde: e.target.value })}
            required
          />
          <Campo
            etiqueta="Hasta"
            type="time"
            value={f.horaHasta}
            onChange={(e) => setF({ ...f, horaHasta: e.target.value })}
            required
          />
        </>
      )}
      <div className="sm:col-span-2">
        <Casilla
          etiqueta="Pedir seña"
          checked={f.requiereSena}
          onChange={(e) => setF({ ...f, requiereSena: e.target.checked })}
        />
      </div>
      {f.requiereSena ? (
        <>
          <Selector
            etiqueta="Tipo de seña"
            value={f.tipoSena}
            onChange={(e) =>
              setF({ ...f, tipoSena: e.target.value as 'PORCENTAJE' | 'MONTO_FIJO', valor: '' })
            }
          >
            <option value="PORCENTAJE">Porcentaje del turno</option>
            <option value="MONTO_FIJO">Monto fijo</option>
          </Selector>
          <Campo
            etiqueta={f.tipoSena === 'PORCENTAJE' ? 'Porcentaje (%)' : 'Monto ($)'}
            inputMode="decimal"
            value={f.valor}
            onChange={(e) => setF({ ...f, valor: e.target.value })}
            required
            aria-invalid={f.valor !== '' && !valorOk}
          />
          <Campo
            etiqueta="Minutos para pagar"
            type="number"
            min={3}
            max={2880}
            value={f.minutosExpiracion}
            onChange={(e) => setF({ ...f, minutosExpiracion: e.target.value })}
            required
            ayuda="Pasado este tiempo sin pago, el turno se libera solo."
          />
          <Campo
            etiqueta="Margen antes del turno (min)"
            type="number"
            min={0}
            max={1440}
            value={f.margenMinAntesInicio}
            onChange={(e) => setF({ ...f, margenMinAntesInicio: e.target.value })}
            required
            ayuda="El plazo para pagar nunca pasa de este margen antes de que empiece el turno."
          />
        </>
      ) : null}
      <Campo
        etiqueta="Prioridad"
        type="number"
        min={0}
        max={1000}
        value={f.prioridad}
        onChange={(e) => setF({ ...f, prioridad: e.target.value })}
        required
        ayuda="Mayor número, gana."
      />
      <div className="sm:self-end">
        <Casilla
          etiqueta="Activa"
          checked={f.activa}
          onChange={(e) => setF({ ...f, activa: e.target.checked })}
        />
      </div>
      {!valorOk && f.valor !== '' ? (
        <div className="sm:col-span-2">
          <Aviso>
            {f.tipoSena === 'PORCENTAJE'
              ? 'El porcentaje va de 0 a 100.'
              : 'Escribí el monto en pesos (ej. 15000).'}
          </Aviso>
        </div>
      ) : null}
      {guardar.error ? (
        <div className="sm:col-span-2">
          <Aviso>{mensajeDe(guardar.error)}</Aviso>
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <Boton type="submit" disabled={guardar.isPending} className="w-full">
          {regla ? 'Guardar cambios' : 'Agregar regla'}
        </Boton>
      </div>
    </form>
  );
}
