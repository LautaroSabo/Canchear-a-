import { partesLocales } from '@cancheria/core';
import { clubs, planesAbono } from '@cancheria/db/schema';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Ejecutor, Entorno } from './entorno.ts';
import { ErrorNegocio } from './errores.ts';

const ZONA = 'America/Argentina/Buenos_Aires';

export interface Plan {
  nombre: string;
  /** Vale desde esta cantidad de canchas activas hasta la del plan siguiente - 1. */
  desdeCanchas: number;
  /** centavos por mes */
  precio: number;
}

export interface Especial {
  descuentoPct: number | null;
  precioFijo: number | null;
  /** Último día con el precio especial (null: sin vencimiento). */
  hasta: string | null;
  motivo: string | null;
}

export interface PrecioClub {
  canchas: number;
  plan: Plan | null;
  /** Precio del plan (sin descuentos). */
  precioLista: number | null;
  /** Lo que paga hoy, con el precio especial si está vigente. */
  precio: number | null;
  /** Precio especial vigente (null si no tiene o ya venció). */
  especial: Especial | null;
}

/** El plan de una cantidad de canchas: el de mayor `desdeCanchas` que no la supere. */
export function planPara(planes: Plan[], cantidad: number): Plan | null {
  return (
    [...planes].sort((a, b) => b.desdeCanchas - a.desdeCanchas).find((p) => cantidad >= p.desdeCanchas) ??
    null
  );
}

/** Precio con el especial aplicado (redondeado a pesos enteros). */
export function aplicarEspecial(lista: number | null, e: Especial | null): number | null {
  if (!e) return lista;
  if (e.precioFijo !== null) return e.precioFijo;
  if (lista === null || e.descuentoPct === null) return lista;
  return Math.round((lista * (100 - e.descuentoPct)) / 100 / 100) * 100;
}

/**
 * Precio del abono de cada club: según cuántas canchas activas tiene (planes que edita la
 * plataforma) y, si tiene, su precio especial (fundador, acuerdo) mientras esté vigente.
 */
export class ServicioPlanes {
  constructor(private readonly e: Entorno) {}

  private hoy() {
    return partesLocales(this.e.reloj(), ZONA).fecha;
  }

  async planes(db: Ejecutor = this.e.db): Promise<Plan[]> {
    return db
      .select({
        nombre: planesAbono.nombre,
        desdeCanchas: planesAbono.desdeCanchas,
        precio: planesAbono.precio,
      })
      .from(planesAbono)
      .orderBy(asc(planesAbono.desdeCanchas));
  }

  /** Reemplaza todos los planes. El primero tiene que arrancar en 1 cancha. */
  async guardarPlanes(planes: Plan[]) {
    const orden = [...planes].sort((a, b) => a.desdeCanchas - b.desdeCanchas);
    if (orden[0]?.desdeCanchas !== 1) {
      throw new ErrorNegocio(422, 'PLANES_INVALIDOS', 'El primer plan tiene que arrancar en 1 cancha');
    }
    if (new Set(orden.map((p) => p.desdeCanchas)).size !== orden.length) {
      throw new ErrorNegocio(
        422,
        'PLANES_INVALIDOS',
        'Dos planes no pueden arrancar en la misma cantidad de canchas',
      );
    }
    await this.e.db.transaction(async (tx) => {
      await tx.delete(planesAbono);
      await tx
        .insert(planesAbono)
        .values(
          orden.map((p) => ({ nombre: p.nombre.trim(), desdeCanchas: p.desdeCanchas, precio: p.precio })),
        );
    });
  }

  /** Precio de varios clubes de una vez (todos si no se pasan ids). */
  async precios(clubIds?: string[], db: Ejecutor = this.e.db): Promise<Map<string, PrecioClub>> {
    if (clubIds && clubIds.length === 0) return new Map();
    const [planes, filas] = await Promise.all([
      this.planes(db),
      db
        .select({
          id: clubs.id,
          canchas: sql<number>`(SELECT count(*)::int FROM canchas ca WHERE ca.club_id = clubs.id AND ca.activa)`,
          descuentoPct: clubs.abonoDescuentoPct,
          precioFijo: clubs.abonoPrecioFijo,
          hasta: clubs.abonoEspecialHasta,
          motivo: clubs.abonoEspecialMotivo,
        })
        .from(clubs)
        .where(clubIds ? inArray(clubs.id, clubIds) : undefined),
    ]);
    const hoy = this.hoy();
    return new Map(
      filas.map((f) => {
        // Un club sin canchas cargadas todavía se cotiza como el plan más chico.
        const plan = planPara(planes, Math.max(1, f.canchas));
        const tieneEspecial = f.descuentoPct !== null || f.precioFijo !== null;
        const vigente = tieneEspecial && (!f.hasta || f.hasta >= hoy);
        const especial = vigente
          ? { descuentoPct: f.descuentoPct, precioFijo: f.precioFijo, hasta: f.hasta, motivo: f.motivo }
          : null;
        const precioLista = plan?.precio ?? null;
        return [
          f.id,
          { canchas: f.canchas, plan, precioLista, precio: aplicarEspecial(precioLista, especial), especial },
        ];
      }),
    );
  }

  async precioDe(clubId: string, db: Ejecutor = this.e.db): Promise<PrecioClub> {
    const p = (await this.precios([clubId], db)).get(clubId);
    if (!p) throw new ErrorNegocio(404, 'CLUB_NO_ENCONTRADO', 'No existe ese club');
    return p;
  }

  /** Precio especial para un club: un % de descuento o un precio fijo, con o sin vencimiento. */
  async ponerEspecial(
    clubId: string,
    e: {
      descuentoPct?: number | null | undefined;
      precioFijo?: number | null | undefined;
      hasta?: string | null | undefined;
      motivo?: string | null | undefined;
    },
  ) {
    const pct = e.descuentoPct ?? null;
    const fijo = e.precioFijo ?? null;
    if ((pct === null) === (fijo === null)) {
      throw new ErrorNegocio(
        422,
        'ESPECIAL_INVALIDO',
        'Poné un porcentaje de descuento o un precio fijo (uno de los dos)',
      );
    }
    const filas = await this.e.db
      .update(clubs)
      .set({
        abonoDescuentoPct: pct,
        abonoPrecioFijo: fijo,
        abonoEspecialHasta: e.hasta ?? null,
        abonoEspecialMotivo: e.motivo?.trim() || null,
      })
      .where(and(eq(clubs.id, clubId), eq(clubs.activo, true)))
      .returning({ id: clubs.id });
    if (!filas.length) throw new ErrorNegocio(404, 'CLUB_NO_ENCONTRADO', 'No existe ese club');
  }

  async quitarEspecial(clubId: string) {
    await this.e.db
      .update(clubs)
      .set({
        abonoDescuentoPct: null,
        abonoPrecioFijo: null,
        abonoEspecialHasta: null,
        abonoEspecialMotivo: null,
      })
      .where(eq(clubs.id, clubId));
  }
}
