import { turnos } from '@cancheria/db/schema';
import { eq, sql } from 'drizzle-orm';
import type { Ejecutor } from './entorno.ts';

// La cuenta de un turno: precio + cantina a cuenta − canjes de puntos aplicados − pagos.
// `turnos.id` va calificado a mano en las subconsultas: en un SELECT de una sola tabla
// Drizzle escribe solo "id", que adentro de la subconsulta sería el id de otra tabla.

/** Lo consumido en la cantina a cuenta del turno (ventas no anuladas). */
export const consumosDeTurnoSql = sql<string>`(
  SELECT coalesce(sum(v.total), 0) FROM ventas_cantina v
   WHERE v.turno_id = turnos.id AND v.anulada_en IS NULL)`;

/** Descuentos de canjes de puntos aplicados al turno. */
export const descuentosDeTurnoSql = sql<string>`(
  SELECT coalesce(sum(c.monto_aplicado), 0) FROM canjes c
   WHERE c.turno_id = turnos.id AND c.estado = 'USADO')`;

/** Pagos aprobados que no se devolvieron. */
export const pagadoDeTurnoSql = sql<string>`(
  SELECT coalesce(sum(p.monto), 0) FROM pagos p
   WHERE p.turno_id = turnos.id AND p.estado = 'APROBADO'
     AND NOT EXISTS (SELECT 1 FROM reembolsos r WHERE r.pago_id = p.id))`;

export interface Cuenta {
  precioTotal: number;
  consumos: number;
  descuentos: number;
  pagado: number;
}

/** Lo que falta cobrar (nunca negativo: si se pagó de más, es 0). */
export const saldoDe = (c: Cuenta) => Math.max(c.precioTotal + c.consumos - c.descuentos - c.pagado, 0);

/** Pasa a número lo que la base devuelve como texto (sumas de bigint). */
export const aCuenta = (f: {
  precioTotal: number;
  consumos: string;
  descuentos: string;
  pagado: string;
}): Cuenta => ({
  precioTotal: f.precioTotal,
  consumos: Number(f.consumos),
  descuentos: Number(f.descuentos),
  pagado: Number(f.pagado),
});

/** Cuenta de un turno; con `bloquear`, toma la fila del turno (FOR UPDATE). */
export async function cuentaDeTurno(tx: Ejecutor, turnoId: string, { bloquear = false } = {}) {
  const q = tx
    .select({
      precioTotal: turnos.precioTotal,
      consumos: consumosDeTurnoSql,
      descuentos: descuentosDeTurnoSql,
      pagado: pagadoDeTurnoSql,
    })
    .from(turnos)
    .where(eq(turnos.id, turnoId));
  const [f] = bloquear ? await q.for('update') : await q;
  return f ? aCuenta(f) : null;
}
