import { enFranja } from './tiempo.ts';

/** Contexto de un turno en hora local del club. */
export interface ContextoTurno {
  canchaId: string;
  /** Día de la semana de la fecha calendario en que empieza el turno. */
  diaSemana: number;
  /** Minuto local en que empieza el turno: la franja (pico/valle) la define el inicio. */
  minutoInicio: number;
  /** Fecha local 'YYYY-MM-DD' (para vigencias). */
  fecha: string;
}

export interface Tarifa {
  canchaId: string | null;
  diaSemana: number | null;
  horaDesde: string;
  horaHasta: string;
  /** centavos */
  precio: number;
  vigenteDesde: string;
  vigenteHasta: string | null;
}

/**
 * Tarifa aplicable: la de la cancha gana a la general del club, la de un día puntual a
 * la de todos los días y, a igual especificidad, la vigente más reciente.
 */
export function resolverTarifa(tarifas: Tarifa[], t: ContextoTurno): Tarifa | null {
  const candidatas = tarifas.filter(
    (x) =>
      (x.canchaId === null || x.canchaId === t.canchaId) &&
      (x.diaSemana === null || x.diaSemana === t.diaSemana) &&
      enFranja(x.horaDesde, x.horaHasta, t.minutoInicio) &&
      x.vigenteDesde <= t.fecha &&
      (x.vigenteHasta === null || t.fecha <= x.vigenteHasta),
  );
  return (
    candidatas.sort(
      (a, b) =>
        Number(b.canchaId !== null) - Number(a.canchaId !== null) ||
        Number(b.diaSemana !== null) - Number(a.diaSemana !== null) ||
        b.vigenteDesde.localeCompare(a.vigenteDesde),
    )[0] ?? null
  );
}
