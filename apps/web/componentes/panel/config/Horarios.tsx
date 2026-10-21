'use client';

import { useState } from 'react';
import { mensajeDe, panel } from '@/lib/api';
import type { FranjaHorario } from '@/lib/tipos';
import { Aviso, Boton, Tarjeta } from '../../ui';
import { DIAS, ORDEN_SEMANA, useGuardar } from './comunes';

const claseHora = 'min-h-11 rounded-xl border border-[#c9d1cb] bg-white px-3 text-base';

export function Horarios({ horarios }: { horarios: FranjaHorario[] }) {
  const [franjas, setFranjas] = useState(horarios);
  const guardar = useGuardar((clubId) => panel.put(`/clubs/${clubId}/config/horarios`, franjas));
  const cambiado = JSON.stringify(franjas) !== JSON.stringify(horarios);

  const delDia = (dia: number) => franjas.map((f, i) => ({ ...f, i })).filter((f) => f.diaSemana === dia);
  const cambiar = (i: number, campo: 'abre' | 'cierra', valor: string) =>
    setFranjas(franjas.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)));
  const agregar = (dia: number) => {
    const previa = delDia(dia).at(-1);
    setFranjas([...franjas, { diaSemana: dia, abre: previa ? previa.cierra : '10:00', cierra: '00:00' }]);
  };

  return (
    <Tarjeta className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">Horarios de apertura</h2>
      <p className="text-sm text-suave">
        Si cierra después de medianoche, poné la hora del día siguiente (por ejemplo, sábado de 09:00 a
        02:00). Un día sin horarios queda cerrado.
      </p>
      <ul className="flex flex-col divide-y divide-linea">
        {ORDEN_SEMANA.map((dia) => {
          const delDiaActual = delDia(dia);
          return (
            <li key={dia} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
              <div className="w-28 shrink-0 pt-2.5 font-bold">{DIAS[dia]}</div>
              <div className="flex flex-1 flex-col gap-2">
                {delDiaActual.length === 0 ? <div className="pt-2.5 text-sm text-suave">Cerrado</div> : null}
                {delDiaActual.map((f) => (
                  <fieldset key={f.i} className="flex min-w-0 flex-wrap items-center gap-2">
                    <legend className="sr-only">
                      {DIAS[dia]}, franja {f.abre} a {f.cierra}
                    </legend>
                    <input
                      type="time"
                      aria-label={`${DIAS[dia]}: abre`}
                      value={f.abre}
                      onChange={(e) => cambiar(f.i, 'abre', e.target.value)}
                      className={claseHora}
                      required
                    />
                    <span className="text-sm text-suave">a</span>
                    <input
                      type="time"
                      aria-label={`${DIAS[dia]}: cierra`}
                      value={f.cierra}
                      onChange={(e) => cambiar(f.i, 'cierra', e.target.value)}
                      className={claseHora}
                      required
                    />
                    <Boton
                      variante="fantasma"
                      aria-label={`Quitar franja del ${DIAS[dia].toLowerCase()}`}
                      onClick={() => setFranjas(franjas.filter((_, j) => j !== f.i))}
                    >
                      Quitar
                    </Boton>
                  </fieldset>
                ))}
              </div>
              <Boton
                variante="fantasma"
                onClick={() => agregar(dia)}
                aria-label={`Agregar horario al ${DIAS[dia].toLowerCase()}`}
              >
                + Horario
              </Boton>
            </li>
          );
        })}
      </ul>
      {guardar.error ? <Aviso>{mensajeDe(guardar.error)}</Aviso> : null}
      {guardar.isSuccess && !cambiado ? <Aviso tipo="ok">Horarios guardados.</Aviso> : null}
      <div className="flex flex-wrap gap-2">
        <Boton disabled={!cambiado || guardar.isPending} onClick={() => guardar.mutate()}>
          Guardar horarios
        </Boton>
        {cambiado ? (
          <Boton variante="secundario" onClick={() => setFranjas(horarios)}>
            Descartar cambios
          </Boton>
        ) : null}
      </div>
    </Tarjeta>
  );
}
