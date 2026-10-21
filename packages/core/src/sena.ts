import type { ContextoTurno } from './precios.ts';
import { enFranja, sumarMinutos } from './tiempo.ts';

export interface ReglaSena {
  canchaId: string | null;
  diaSemana: number | null;
  horaDesde: string | null;
  horaHasta: string | null;
  requiereSena: boolean;
  tipoSena: 'PORCENTAJE' | 'MONTO_FIJO';
  /** Porcentaje (0-100) o centavos. */
  valorSena: number;
  minutosExpiracion: number;
  margenMinAntesInicio: number;
  prioridad: number;
  activa: boolean;
}

/**
 * Regla de seña aplicable (los null son comodín). Gana la de mayor prioridad y, a igual
 * prioridad, la más específica: cancha > día > franja horaria.
 */
export function resolverRegla(reglas: ReglaSena[], t: Omit<ContextoTurno, 'fecha'>): ReglaSena | null {
  const candidatas = reglas.filter(
    (r) =>
      r.activa &&
      (r.canchaId === null || r.canchaId === t.canchaId) &&
      (r.diaSemana === null || r.diaSemana === t.diaSemana) &&
      (r.horaDesde === null || r.horaHasta === null || enFranja(r.horaDesde, r.horaHasta, t.minutoInicio)),
  );
  return (
    candidatas.sort(
      (a, b) =>
        b.prioridad - a.prioridad ||
        Number(b.canchaId !== null) - Number(a.canchaId !== null) ||
        Number(b.diaSemana !== null) - Number(a.diaSemana !== null) ||
        Number(b.horaDesde !== null) - Number(a.horaDesde !== null),
    )[0] ?? null
  );
}

/** Monto de seña en centavos (nunca mayor al precio del turno). */
export function calcularSena(precioTotal: number, regla: ReglaSena | null): number {
  if (!regla?.requiereSena) return 0;
  const monto =
    regla.tipoSena === 'PORCENTAJE' ? Math.round((precioTotal * regla.valorSena) / 100) : regla.valorSena;
  return Math.min(Math.max(monto, 0), precioTotal);
}

/** Por debajo de este tiempo no tiene sentido abrir un hold esperando un pago. */
export const MINUTOS_MINIMOS_HOLD = 3;

export type Expiracion =
  | { tipo: 'SIN_SENA' }
  | { tipo: 'HOLD'; expiraEn: Date }
  /** El turno empieza demasiado pronto para esperar la seña: hay que reservar por teléfono. */
  | { tipo: 'MUY_CERCA' };

/** expira_en = min(ahora + minutos, inicio − margen). */
export function calcularExpiracion(
  ahora: Date,
  inicio: Date,
  regla: ReglaSena | null,
  montoSena: number,
): Expiracion {
  if (!regla?.requiereSena || montoSena === 0) return { tipo: 'SIN_SENA' };
  const porTimer = sumarMinutos(ahora, regla.minutosExpiracion);
  const porInicio = sumarMinutos(inicio, -regla.margenMinAntesInicio);
  const expiraEn = porTimer < porInicio ? porTimer : porInicio;
  if (expiraEn.getTime() - ahora.getTime() < MINUTOS_MINIMOS_HOLD * 60_000) return { tipo: 'MUY_CERCA' };
  return { tipo: 'HOLD', expiraEn };
}
