import { pagos, turnos } from '@cancheria/db/schema';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Entorno } from './entorno.ts';
import type { ServicioListaEspera } from './lista-espera.ts';
import type { ServicioPagos } from './pagos.ts';
import { registrarExpiraciones, setActor } from './turnos.ts';

export interface ResultadoBarrido {
  conciliados: number;
  expirados: number;
  ofertas: number;
}

interface Logger {
  warn(obj: unknown, msg?: string): void;
}

/**
 * Libera los holds vencidos. La corrección no depende de esto (la grilla y las reservas
 * ya tratan como libre un hold vencido); el barrido existe por los efectos: avisar al
 * cliente, ofrecer el turno a la lista de espera y cerrar el checkout.
 */
export class ServicioExpiracion {
  constructor(
    private readonly e: Entorno & { pagos: ServicioPagos; listaEspera: ServicioListaEspera; log: Logger },
    private readonly lote = 200,
  ) {}

  async barrer(): Promise<ResultadoBarrido> {
    const conciliados = await this.conciliarAntesDeExpirar();
    const ahora = this.e.reloj();

    return this.e.db.transaction(async (tx) => {
      await setActor(tx, 'worker');
      const liberados = await tx.execute<{
        id: string;
        club_id: string;
        cancha_id: string;
        cliente_id: string | null;
        inicio: string;
        fin: string;
      }>(sql`
        UPDATE turnos t SET estado = 'EXPIRADO', expira_en = NULL
          FROM (SELECT id FROM turnos
                 WHERE estado = 'PRE_RESERVADO' AND expira_en <= ${ahora.toISOString()}::timestamptz
                 ORDER BY expira_en
                 LIMIT ${this.lote}
                 FOR UPDATE SKIP LOCKED) v
         WHERE t.id = v.id
        RETURNING t.id, t.club_id, t.cancha_id, t.cliente_id, t.inicio, t.fin`);

      await registrarExpiraciones(
        tx,
        liberados.map((l) => l.id),
        this.e.urlWeb,
      );
      let ofertas = 0;
      for (const l of liberados) {
        const oferta = await this.e.listaEspera.ofrecer(tx, {
          id: l.id,
          clubId: l.club_id,
          canchaId: l.cancha_id,
          clienteId: l.cliente_id,
          inicio: new Date(l.inicio),
          fin: new Date(l.fin),
        });
        if (oferta) ofertas++;
      }
      return { conciliados, expirados: liberados.length, ofertas };
    });
  }

  /**
   * Antes de liberar un hold con checkout de MP abierto se le pregunta a MP si hubo un
   * pago: cubre webhooks demorados o perdidos (y un error en la validación de firma).
   */
  private async conciliarAntesDeExpirar(): Promise<number> {
    const candidatos = await this.e.db
      .selectDistinct({ id: turnos.id, clubId: turnos.clubId })
      .from(turnos)
      .innerJoin(pagos, eq(pagos.turnoId, turnos.id))
      .where(
        and(
          eq(turnos.estado, 'PRE_RESERVADO'),
          lte(turnos.expiraEn, this.e.reloj()),
          eq(pagos.proveedor, 'MERCADO_PAGO'),
          inArray(pagos.estado, ['PENDIENTE']),
        ),
      )
      .limit(50);
    let confirmados = 0;
    for (const c of candidatos) {
      try {
        const resultados = await this.e.pagos.conciliarTurno(c.clubId, c.id);
        if (resultados.some((r) => r.tipo === 'CONFIRMADO')) confirmados++;
      } catch (err) {
        // MP caído: se expira igual; si el pago aparece después, el webhook lo revive o lo devuelve.
        this.e.log.warn({ err, turnoId: c.id }, 'no se pudo conciliar con Mercado Pago');
      }
    }
    return confirmados;
  }
}
