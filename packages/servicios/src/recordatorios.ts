import { sql } from 'drizzle-orm';
import type { Entorno } from './entorno.ts';
import { notificarTurno } from './turnos.ts';

/**
 * Recordatorio por mail unas horas antes del partido (las que fije cada club; 0 = no).
 * Cada turno se procesa una sola vez (turnos.recordatorio_en), aunque corran varios workers.
 * Si se reservó cuando ya faltaba menos que eso, no se manda: le acaba de llegar la
 * confirmación. Sin email en la reserva tampoco sale nada (el turno queda procesado igual).
 */
export class ServicioRecordatorios {
  constructor(private readonly e: Entorno) {}

  async enviar(): Promise<{ enviados: number; salteados: number }> {
    const ahora = this.e.reloj();
    return this.e.db.transaction(async (tx) => {
      const filas = (await tx.execute(sql`
        WITH elegidos AS (
          SELECT t.id, c.horas_recordatorio AS horas
            FROM turnos t
            JOIN clubs c ON c.id = t.club_id
           WHERE t.estado = 'CONFIRMADO'
             AND t.recordatorio_en IS NULL
             AND t.cliente_id IS NOT NULL
             AND c.horas_recordatorio > 0
             AND t.inicio > ${ahora.toISOString()}::timestamptz
             AND t.inicio <= ${ahora.toISOString()}::timestamptz + make_interval(hours => c.horas_recordatorio)
           ORDER BY t.inicio
           LIMIT 200
           FOR UPDATE OF t SKIP LOCKED
        )
        UPDATE turnos t
           SET recordatorio_en = ${ahora.toISOString()}::timestamptz
          FROM elegidos e
         WHERE t.id = e.id
     RETURNING t.id,
               (t.creado_en <= t.inicio - make_interval(hours => e.horas)) AS a_tiempo
      `)) as unknown as { id: string; a_tiempo: boolean }[];
      let enviados = 0;
      for (const f of filas) {
        if (!f.a_tiempo) continue;
        if (await notificarTurno(tx, f.id, 'recordatorio_turno', this.e.urlWeb)) enviados++;
      }
      return { enviados, salteados: filas.length - enviados };
    });
  }
}
