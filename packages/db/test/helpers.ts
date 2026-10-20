import { randomUUID } from 'node:crypto';
import { and, eq, lte, sql } from 'drizzle-orm';
import type { Db } from '../src/client.ts';
import { canchas, clientes, clubs, turnos } from '../src/schema/index.ts';

/** Club aislado por test (slug único), con una cancha y `n` clientes. */
export async function crearEscenario(db: Db, n = 1) {
  const sufijo = randomUUID().slice(0, 8);
  const [club] = await db
    .insert(clubs)
    .values({ slug: `test-${sufijo}`, nombre: `Test ${sufijo}` })
    .returning();
  if (!club) throw new Error('club');
  const [cancha] = await db
    .insert(canchas)
    .values({ clubId: club.id, nombre: 'Cancha 1', jugadoresPorLado: 5 })
    .returning();
  if (!cancha) throw new Error('cancha');
  const lista = await db
    .insert(clientes)
    .values(
      Array.from({ length: n }, (_, i) => ({
        clubId: club.id,
        nombre: `Jugador ${i + 1}`,
        telefonoE164: `+54911${String(i + 1).padStart(8, '0')}`,
      })),
    )
    .returning();
  return { club, cancha, clientes: lista };
}

interface PedidoHold {
  clubId: string;
  canchaId: string;
  clienteId: string;
  inicio: Date;
  fin: Date;
  minutos?: number;
  idempotencyKey?: string;
}

/**
 * Mismo patrón transaccional que usará la API (docs/arquitectura.md §3):
 * expira de forma perezosa los holds vencidos que pisan el rango y luego inserta.
 * La exclusion constraint decide quién gana.
 */
export function crearHold(db: Db, p: PedidoHold) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.actor', 'cliente', true)`);
    await tx
      .update(turnos)
      .set({ estado: 'EXPIRADO', expiraEn: null })
      .where(
        and(
          eq(turnos.canchaId, p.canchaId),
          eq(turnos.estado, 'PRE_RESERVADO'),
          lte(turnos.expiraEn, sql`now()`),
          sql`${turnos.rango} && tstzrange(${p.inicio.toISOString()}::timestamptz, ${p.fin.toISOString()}::timestamptz, '[)')`,
        ),
      );
    const [turno] = await tx
      .insert(turnos)
      .values({
        clubId: p.clubId,
        canchaId: p.canchaId,
        clienteId: p.clienteId,
        inicio: p.inicio,
        fin: p.fin,
        estado: 'PRE_RESERVADO',
        origen: 'WEB',
        precioTotal: 4_500_000,
        montoSena: 2_250_000,
        expiraEn: new Date(Date.now() + (p.minutos ?? 10) * 60_000),
        ...(p.idempotencyKey ? { idempotencyKey: p.idempotencyKey } : {}),
      })
      .returning();
    if (!turno) throw new Error('insert sin filas');
    return turno;
  });
}

/** Sábado 2030-01-05 a la hora local de Buenos Aires (UTC-3). */
export const hora = (hhmm: string) => new Date(`2030-01-05T${hhmm}:00-03:00`);
