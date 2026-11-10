import { instanteLocal, partesLocales } from '@cancheria/core';
import type { Tx } from '@cancheria/db';
import { cierresCaja, clubs, pagos, reembolsos, usuarios, ventasCantina } from '@cancheria/db/schema';
import { and, desc, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import type { RepoClubs } from './config-club.ts';
import type { Ejecutor, Entorno } from './entorno.ts';
import { ErrorNegocio } from './errores.ts';

export type Medio = 'EFECTIVO' | 'TRANSFERENCIA' | 'MERCADO_PAGO' | 'OTRO';
const MEDIOS: Medio[] = ['EFECTIVO', 'TRANSFERENCIA', 'MERCADO_PAGO', 'OTRO'];

export interface FilaCaja {
  medio: Medio;
  /** Señas cobradas (online o en el club). */
  senas: number;
  /** Saldos de turnos cobrados en el club. */
  saldos: number;
  /** Ventas de cantina en el mostrador (las que van a cuenta del turno se cobran con el saldo). */
  cantina: number;
  /** Devoluciones hechas (resta). */
  devoluciones: number;
  total: number;
}

export interface ResumenCaja {
  desde: Date;
  hasta: Date;
  porMedio: FilaCaja[];
  total: number;
  /** Lo que tendría que haber en la caja física. */
  efectivoEsperado: number;
  /** Cuántos movimientos entraron (para "no hubo nada"). */
  movimientos: number;
}

/**
 * Cierre de caja: lo que entró entre el cierre anterior y ahora (sin incluir el instante del
 * cierre anterior, que ya contó ese cierre), por medio de pago. Cada
 * cierre arranca donde terminó el anterior (sirve para turno mañana / turno tarde); el
 * primero del club, desde el comienzo del día.
 */
export class ServicioCaja {
  constructor(private readonly e: Entorno & { clubs: RepoClubs }) {}

  async actual(clubId: string) {
    const ultimo = await this.ultimoCierre(this.e.db, clubId);
    const desde = ultimo?.hasta ?? (await this.inicioDelDia(clubId));
    return {
      ...(await this.resumen(this.e.db, clubId, desde, this.e.reloj())),
      ultimoCierre: ultimo ? { hasta: ultimo.hasta, usuario: ultimo.usuario } : null,
    };
  }

  async cerrar(
    clubId: string,
    usuarioId: string,
    d: { efectivoContado: number; nota?: string | null | undefined },
  ) {
    return this.e.db.transaction(async (tx) => {
      // Un cierre a la vez por club: dos encargados no cierran el mismo período dos veces.
      await tx.select({ id: clubs.id }).from(clubs).where(eq(clubs.id, clubId)).for('update');
      const ultimo = await this.ultimoCierre(tx, clubId);
      const hasta = this.e.reloj();
      const desde = ultimo?.hasta ?? (await this.inicioDelDia(clubId));
      if (hasta <= desde) throw new ErrorNegocio(409, 'RECIEN_CERRADA', 'La caja se acaba de cerrar');
      const r = await this.resumen(tx, clubId, desde, hasta);
      const [c] = await tx
        .insert(cierresCaja)
        .values({
          clubId,
          desde,
          hasta,
          usuarioId,
          efectivoEsperado: r.efectivoEsperado,
          efectivoContado: d.efectivoContado,
          detalle: { porMedio: r.porMedio, total: r.total, movimientos: r.movimientos },
          nota: d.nota?.trim() || null,
        })
        .returning();
      if (!c) throw new Error('cierre sin filas');
      return { ...this.publico(c), resumen: r };
    });
  }

  async historial(clubId: string, limite = 30) {
    const filas = await this.e.db
      .select({ c: cierresCaja, usuario: usuarios.nombre })
      .from(cierresCaja)
      .innerJoin(usuarios, eq(usuarios.id, cierresCaja.usuarioId))
      .where(eq(cierresCaja.clubId, clubId))
      .orderBy(desc(cierresCaja.hasta))
      .limit(limite);
    return filas.map((f) => ({ ...this.publico(f.c), usuario: f.usuario, detalle: f.c.detalle }));
  }

  private publico(c: typeof cierresCaja.$inferSelect) {
    return {
      id: c.id,
      desde: c.desde.toISOString(),
      hasta: c.hasta.toISOString(),
      efectivoEsperado: c.efectivoEsperado,
      efectivoContado: c.efectivoContado,
      /** Positivo: sobra plata; negativo: falta. */
      diferencia: c.efectivoContado - c.efectivoEsperado,
      nota: c.nota,
    };
  }

  private async ultimoCierre(db: Ejecutor | Tx, clubId: string) {
    const [u] = await db
      .select({ hasta: cierresCaja.hasta, usuario: usuarios.nombre })
      .from(cierresCaja)
      .innerJoin(usuarios, eq(usuarios.id, cierresCaja.usuarioId))
      .where(eq(cierresCaja.clubId, clubId))
      .orderBy(desc(cierresCaja.hasta))
      .limit(1);
    return u ?? null;
  }

  private async inicioDelDia(clubId: string) {
    const zona = (await this.e.clubs.porId(clubId))?.club.zonaHoraria ?? 'America/Argentina/Buenos_Aires';
    return instanteLocal(partesLocales(this.e.reloj(), zona).fecha, '00:00', zona);
  }

  private async resumen(db: Ejecutor | Tx, clubId: string, desde: Date, hasta: Date): Promise<ResumenCaja> {
    const cuando = sql`coalesce(${pagos.acreditadoEn}, ${pagos.creadoEn})`;
    const [cobros, ventas, devueltos] = await Promise.all([
      db
        .select({
          medio: pagos.proveedor,
          concepto: pagos.concepto,
          monto: sql<string>`sum(${pagos.monto})`,
          n: sql<number>`count(*)::int`,
        })
        .from(pagos)
        .where(
          and(
            eq(pagos.clubId, clubId),
            eq(pagos.estado, 'APROBADO'),
            sql`${cuando} > ${desde.toISOString()}::timestamptz`,
            sql`${cuando} <= ${hasta.toISOString()}::timestamptz`,
          ),
        )
        .groupBy(pagos.proveedor, pagos.concepto),
      db
        .select({
          medio: ventasCantina.medio,
          monto: sql<string>`sum(${ventasCantina.total})`,
          n: sql<number>`count(*)::int`,
        })
        .from(ventasCantina)
        .where(
          and(
            eq(ventasCantina.clubId, clubId),
            isNull(ventasCantina.anuladaEn),
            isNull(ventasCantina.turnoId),
            gt(ventasCantina.creadoEn, desde),
            lte(ventasCantina.creadoEn, hasta),
          ),
        )
        .groupBy(ventasCantina.medio),
      db
        .select({
          medio: pagos.proveedor,
          monto: sql<string>`sum(${reembolsos.monto})`,
          n: sql<number>`count(*)::int`,
        })
        .from(reembolsos)
        .innerJoin(pagos, eq(pagos.id, reembolsos.pagoId))
        .where(
          and(
            eq(reembolsos.clubId, clubId),
            eq(reembolsos.estado, 'HECHO'),
            gt(reembolsos.hechoEn, desde),
            lte(reembolsos.hechoEn, hasta),
          ),
        )
        .groupBy(pagos.proveedor),
    ]);
    const filas = new Map<Medio, FilaCaja>(
      MEDIOS.map((m) => [m, { medio: m, senas: 0, saldos: 0, cantina: 0, devoluciones: 0, total: 0 }]),
    );
    const fila = (m: string | null) =>
      filas.get((MEDIOS as string[]).includes(m ?? '') ? (m as Medio) : 'OTRO') as FilaCaja;
    let movimientos = 0;
    for (const c of cobros) {
      const f = fila(c.medio);
      if (c.concepto === 'SENA') f.senas += Number(c.monto);
      else f.saldos += Number(c.monto);
      movimientos += c.n;
    }
    for (const v of ventas) {
      fila(v.medio).cantina += Number(v.monto);
      movimientos += v.n;
    }
    for (const d of devueltos) {
      fila(d.medio).devoluciones += Number(d.monto);
      movimientos += d.n;
    }
    for (const f of filas.values()) f.total = f.senas + f.saldos + f.cantina - f.devoluciones;
    const porMedio = [...filas.values()];
    return {
      desde,
      hasta,
      porMedio,
      total: porMedio.reduce((a, f) => a + f.total, 0),
      efectivoEsperado: filas.get('EFECTIVO')?.total ?? 0,
      movimientos,
    };
  }
}
