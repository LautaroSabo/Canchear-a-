import { pagos, reembolsos } from '@cancheria/db/schema';
import { eq, sql } from 'drizzle-orm';
import type { Cifrador } from './cifrado.ts';
import { leerCredencialesMp } from './credenciales.ts';
import type { Entorno } from './entorno.ts';
import { pesos } from './formato.ts';
import type { PasarelaMp } from './mercadopago/pasarela.ts';
import { MOTIVOS_REEMBOLSO } from './notificaciones/plantillas.ts';
import { notificarTurno } from './turnos.ts';

const MAX_INTENTOS = 8;
const LEASE_MIN = 5;

/**
 * Ejecuta contra Mercado Pago los reembolsos registrados. Patrón "lease": se reclama un
 * lote corriendo su próximo intento (commit inmediato), se llama a MP fuera de toda
 * transacción y se marca el resultado. Si el worker muere, el lease vence y otro lo
 * reintenta; el refund usa el id del reembolso como clave de idempotencia en MP.
 */
export class ServicioReembolsos {
  constructor(private readonly e: Entorno & { pasarela: PasarelaMp; cifrador: Cifrador }) {}

  async procesar(lote = 20): Promise<{ hechos: number; fallidos: number }> {
    const ahora = this.e.reloj();
    const reclamados = await this.e.db.execute<{
      id: string;
      club_id: string;
      monto: string;
      motivo: string;
      intentos: number;
      external_id: string | null;
      turno_id: string;
    }>(sql`
      UPDATE reembolsos r
         SET proximo_intento = ${ahora.toISOString()}::timestamptz + make_interval(mins => ${LEASE_MIN}),
             intentos = r.intentos + 1
        FROM pagos p
       WHERE p.id = r.pago_id
         AND r.id IN (SELECT r2.id FROM reembolsos r2
                        JOIN pagos p2 ON p2.id = r2.pago_id
                       WHERE r2.estado = 'PENDIENTE'
                         AND p2.proveedor = 'MERCADO_PAGO'
                         AND r2.proximo_intento <= ${ahora.toISOString()}::timestamptz
                       ORDER BY r2.proximo_intento
                       LIMIT ${lote}
                       FOR UPDATE OF r2 SKIP LOCKED)
      RETURNING r.id, r.club_id, r.monto, r.motivo, r.intentos, p.external_id, p.turno_id`);

    let hechos = 0;
    let fallidos = 0;
    for (const r of reclamados) {
      try {
        const cred = await leerCredencialesMp(this.e.db, this.e.cifrador, r.club_id);
        if (!cred) throw new Error('el club no tiene credenciales de Mercado Pago');
        if (!r.external_id) throw new Error('pago sin id de Mercado Pago');
        const hecho = await this.e.pasarela.reembolsar(cred.accessToken, r.external_id, r.id);

        await this.e.db.transaction(async (tx) => {
          await tx
            .update(reembolsos)
            .set({ estado: 'HECHO', externalId: hecho.id, hechoEn: this.e.reloj(), error: null })
            .where(eq(reembolsos.id, r.id));
          await tx
            .update(pagos)
            .set({ estado: 'REEMBOLSADO' })
            .where(eq(pagos.externalId, r.external_id as string));
          await notificarTurno(tx, r.turno_id, 'pago_reembolsado', this.e.urlWeb, {
            monto: pesos(Number(r.monto)),
            motivo: MOTIVOS_REEMBOLSO[r.motivo] ?? r.motivo,
          });
        });
        hechos++;
      } catch (err) {
        const agotado = r.intentos >= MAX_INTENTOS;
        // Backoff exponencial: 2, 4, 8 … minutos.
        await this.e.db
          .update(reembolsos)
          .set({
            estado: agotado ? 'FALLIDO' : 'PENDIENTE',
            error: err instanceof Error ? err.message : String(err),
            proximoIntento: new Date(ahora.getTime() + 2 ** r.intentos * 60_000),
          })
          .where(eq(reembolsos.id, r.id));
        if (agotado) fallidos++;
      }
    }
    return { hechos, fallidos };
  }
}
