import type { Db } from '@cancheria/db';
import { notificaciones } from '@cancheria/db/schema';
import { eq, sql } from 'drizzle-orm';
import type { Reloj } from '../entorno.ts';
import type { CanalMensajes } from './canales.ts';
import type { Plantilla } from './plantillas.ts';

const MAX_INTENTOS = 6;

/**
 * Despacha la outbox. Mismo patrón lease que los reembolsos: reclamar (commit), enviar
 * fuera de la transacción, marcar. Si el proceso muere después de enviar y antes de
 * marcar, el mensaje puede salir dos veces: es preferible a perderlo.
 */
export class Despachador {
  constructor(
    private readonly db: Db,
    private readonly reloj: Reloj,
    private readonly canal: CanalMensajes,
  ) {}

  async procesar(lote = 50): Promise<{ enviadas: number; fallidas: number }> {
    const ahora = this.reloj();
    const reclamadas = await this.db.execute<{
      id: string;
      destino: string;
      plantilla: string;
      payload: Record<string, string>;
      intentos: number;
    }>(sql`
      UPDATE notificaciones SET proximo_intento = ${ahora.toISOString()}::timestamptz + interval '2 minutes',
                                intentos = intentos + 1
       WHERE id IN (SELECT id FROM notificaciones
                     WHERE estado = 'PENDIENTE' AND proximo_intento <= ${ahora.toISOString()}::timestamptz
                     ORDER BY proximo_intento
                     LIMIT ${lote}
                     FOR UPDATE SKIP LOCKED)
      RETURNING id, destino, plantilla, payload, intentos`);

    let enviadas = 0;
    let fallidas = 0;
    for (const n of reclamadas) {
      try {
        await this.canal.enviar(n.destino, n.plantilla as Plantilla, n.payload);
        await this.db
          .update(notificaciones)
          .set({ estado: 'ENVIADA', enviadaEn: this.reloj(), error: null })
          .where(eq(notificaciones.id, n.id));
        enviadas++;
      } catch (err) {
        const agotada = n.intentos >= MAX_INTENTOS;
        await this.db
          .update(notificaciones)
          .set({
            estado: agotada ? 'FALLIDA' : 'PENDIENTE',
            error: err instanceof Error ? err.message : String(err),
            proximoIntento: new Date(ahora.getTime() + 2 ** n.intentos * 30_000),
          })
          .where(eq(notificaciones.id, n.id));
        if (agotada) fallidas++;
      }
    }
    return { enviadas, fallidas };
  }
}
