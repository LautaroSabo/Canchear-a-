'use client';

import { useState } from 'react';
import { mensajeDe, panel } from '@/lib/api';
import { fechaLarga } from '@/lib/formato';
import type { DiaEspecial } from '@/lib/tipos';
import { Aviso, Boton, Campo, Casilla, Tarjeta } from '../../ui';
import { useGuardar } from './comunes';

export function DiasEspeciales({ dias }: { dias: DiaEspecial[] }) {
  const vacio = { fecha: '', cerrado: true, abre: '', cierra: '', motivo: '' };
  const [f, setF] = useState(vacio);
  const guardar = useGuardar(
    (clubId) =>
      panel.put(`/clubs/${clubId}/config/dias-especiales/${f.fecha}`, {
        cerrado: f.cerrado,
        abre: f.cerrado ? null : f.abre,
        cierra: f.cerrado ? null : f.cierra,
        motivo: f.motivo.trim() || null,
      }),
    () => setF(vacio),
  );
  const borrar = useGuardar((clubId, fecha: string) =>
    panel.borrar(`/clubs/${clubId}/config/dias-especiales/${fecha}`),
  );

  return (
    <Tarjeta className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">Feriados y días especiales</h2>
      <p className="text-sm text-suave">
        Para cerrar un día o abrir con otro horario. No cancela los turnos ya tomados: revisalos en la agenda.
      </p>
      {dias.length ? (
        <ul className="flex flex-col divide-y divide-linea">
          {dias.map((d) => (
            <li key={d.fecha} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div>
                <div className="font-bold first-letter:uppercase">{fechaLarga(d.fecha)}</div>
                <div className="text-sm text-medio">
                  {d.cerrado ? 'Cerrado' : `Abre de ${d.abre} a ${d.cierra}`}
                  {d.motivo ? ` · ${d.motivo}` : ''}
                </div>
              </div>
              <Boton variante="fantasma" disabled={borrar.isPending} onClick={() => borrar.mutate(d.fecha)}>
                Quitar
              </Boton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">No hay días especiales cargados.</p>
      )}
      <form
        className="grid gap-3 rounded-xl bg-fondo p-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          guardar.mutate();
        }}
      >
        <Campo
          etiqueta="Fecha"
          type="date"
          value={f.fecha}
          onChange={(e) => setF({ ...f, fecha: e.target.value })}
          required
        />
        <Campo
          etiqueta="Motivo (opcional)"
          value={f.motivo}
          maxLength={120}
          placeholder="Feriado, torneo…"
          onChange={(e) => setF({ ...f, motivo: e.target.value })}
        />
        <div className="sm:col-span-2">
          <Casilla
            etiqueta="Cerrado todo el día"
            checked={f.cerrado}
            onChange={(e) => setF({ ...f, cerrado: e.target.checked })}
          />
        </div>
        {f.cerrado ? null : (
          <>
            <Campo
              etiqueta="Abre"
              type="time"
              value={f.abre}
              onChange={(e) => setF({ ...f, abre: e.target.value })}
              required
            />
            <Campo
              etiqueta="Cierra"
              type="time"
              value={f.cierra}
              onChange={(e) => setF({ ...f, cierra: e.target.value })}
              required
            />
          </>
        )}
        {guardar.error || borrar.error ? (
          <div className="sm:col-span-2">
            <Aviso>{mensajeDe(guardar.error ?? borrar.error)}</Aviso>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <Boton type="submit" disabled={guardar.isPending}>
            Guardar día especial
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}
