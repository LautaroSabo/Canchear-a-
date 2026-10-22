import { enFranja } from './tiempo.ts';

export interface PromocionPuntos {
  id: string;
  diaSemana: number | null;
  horaDesde: string | null;
  horaHasta: string | null;
  /** 1.5 = 50 % más. */
  multiplicador: number;
  puntosExtra: number;
  vigenteDesde: string;
  vigenteHasta: string | null;
  activa: boolean;
}

/**
 * Puntos que suma un partido: la base del club, o la mejor promoción que aplique a la
 * fecha y hora local en que empieza (nunca se acumulan dos promociones: gana la que
 * más da). Con base 0 el club no tiene fidelización y no suma nada.
 */
export function calcularPuntos(
  base: number,
  promos: PromocionPuntos[],
  t: { diaSemana: number; minutoInicio: number; fecha: string },
): { puntos: number; promocionId: string | null } {
  if (base <= 0) return { puntos: 0, promocionId: null };
  let mejor = { puntos: base, promocionId: null as string | null };
  for (const p of promos) {
    if (!p.activa || t.fecha < p.vigenteDesde || (p.vigenteHasta !== null && t.fecha > p.vigenteHasta))
      continue;
    if (p.diaSemana !== null && p.diaSemana !== t.diaSemana) continue;
    if (p.horaDesde && p.horaHasta && !enFranja(p.horaDesde, p.horaHasta, t.minutoInicio)) continue;
    const puntos = Math.round(base * p.multiplicador) + p.puntosExtra;
    if (puntos > mejor.puntos) mejor = { puntos, promocionId: p.id };
  }
  return mejor;
}

/** Valor de un premio de descuento sobre el precio de un turno (centavos). */
export function descuentoDePremio(
  premio: { tipo: 'DESCUENTO_MONTO' | 'DESCUENTO_PORCENTAJE' | 'TURNO_GRATIS' | 'PRODUCTO'; valor: number },
  precioTurno: number,
): number {
  switch (premio.tipo) {
    case 'TURNO_GRATIS':
      return precioTurno;
    case 'DESCUENTO_PORCENTAJE':
      return Math.round((precioTurno * Math.min(premio.valor, 100)) / 100);
    case 'DESCUENTO_MONTO':
      return Math.min(premio.valor, precioTurno);
    default:
      return 0;
  }
}
