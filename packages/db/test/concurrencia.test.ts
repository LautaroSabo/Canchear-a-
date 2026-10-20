import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { crearDb } from '../src/client.ts';
import { esTurnoOcupado, violaUnique } from '../src/errores.ts';
import { turnos, turnosEventos } from '../src/schema/index.ts';
import { crearEscenario, crearHold, hora } from './helpers.ts';

const { db, cerrar } = crearDb(inject('databaseUrl'), { max: 60 });
afterAll(cerrar);

const vencer = (id: string) =>
  db.update(turnos).set({ expiraEn: sql`now() - interval '1 second'` }).where(eq(turnos.id, id));

describe('anti-sobrerreserva', () => {
  it('50 reservas simultáneas por el mismo horario: gana exactamente una', async () => {
    const { club, cancha, clientes } = await crearEscenario(db, 50);

    const resultados = await Promise.allSettled(
      clientes.map((c) =>
        crearHold(db, {
          clubId: club.id,
          canchaId: cancha.id,
          clienteId: c.id,
          inicio: hora('20:00'),
          fin: hora('21:00'),
        }),
      ),
    );

    const exitos = resultados.filter((r) => r.status === 'fulfilled');
    const rechazos = resultados.filter((r) => r.status === 'rejected');
    expect(exitos).toHaveLength(1);
    expect(rechazos).toHaveLength(49);
    for (const r of rechazos) expect(esTurnoOcupado(r.reason)).toBe(true);

    const vivos = await db.select().from(turnos).where(eq(turnos.canchaId, cancha.id));
    expect(vivos).toHaveLength(1);
  });

  it('permite turnos contiguos y rechaza solapamientos parciales', async () => {
    const { club, cancha, clientes } = await crearEscenario(db, 3);
    const [a, b, c] = clientes as [(typeof clientes)[0], (typeof clientes)[0], (typeof clientes)[0]];
    const base = { clubId: club.id, canchaId: cancha.id };

    await crearHold(db, { ...base, clienteId: a.id, inicio: hora('20:00'), fin: hora('21:00') });
    await expect(
      crearHold(db, { ...base, clienteId: b.id, inicio: hora('21:00'), fin: hora('22:00') }),
    ).resolves.toBeDefined();
    const solapado = crearHold(db, { ...base, clienteId: c.id, inicio: hora('20:30'), fin: hora('21:30') });
    await expect(solapado).rejects.toSatisfy(esTurnoOcupado);
  });

  it('otra cancha a la misma hora no choca', async () => {
    const e1 = await crearEscenario(db);
    const e2 = await crearEscenario(db);
    for (const e of [e1, e2]) {
      await crearHold(db, {
        clubId: e.club.id,
        canchaId: e.cancha.id,
        clienteId: e.clientes[0]!.id,
        inicio: hora('20:00'),
        fin: hora('21:00'),
      });
    }
  });

  it('un turno CANCELADO libera la cancha', async () => {
    const { club, cancha, clientes } = await crearEscenario(db, 2);
    const pedido = { clubId: club.id, canchaId: cancha.id, inicio: hora('20:00'), fin: hora('21:00') };
    const t = await crearHold(db, { ...pedido, clienteId: clientes[0]!.id });
    await db.update(turnos).set({ estado: 'CANCELADO', expiraEn: null }).where(eq(turnos.id, t.id));
    await expect(crearHold(db, { ...pedido, clienteId: clientes[1]!.id })).resolves.toBeDefined();
  });

  it('la idempotency key evita duplicar la reserva en un doble clic', async () => {
    const { club, cancha, clientes } = await crearEscenario(db);
    const pedido = {
      clubId: club.id,
      canchaId: cancha.id,
      clienteId: clientes[0]!.id,
      idempotencyKey: randomUUID(),
    };
    await crearHold(db, { ...pedido, inicio: hora('18:00'), fin: hora('19:00') });
    const repetido = crearHold(db, { ...pedido, inicio: hora('22:00'), fin: hora('23:00') });
    await expect(repetido).rejects.toSatisfy((e) => violaUnique(e, 'turnos_idempotency_uq'));
  });
});

describe('expiración del hold', () => {
  it('un hold vencido no bloquea aunque el worker no haya pasado', async () => {
    const { club, cancha, clientes } = await crearEscenario(db, 2);
    const pedido = { clubId: club.id, canchaId: cancha.id, inicio: hora('20:00'), fin: hora('21:00') };
    const viejo = await crearHold(db, { ...pedido, clienteId: clientes[0]!.id });
    await vencer(viejo.id);

    const nuevo = await crearHold(db, { ...pedido, clienteId: clientes[1]!.id });
    expect(nuevo.estado).toBe('PRE_RESERVADO');
    const [actualizado] = await db.select().from(turnos).where(eq(turnos.id, viejo.id));
    expect(actualizado?.estado).toBe('EXPIRADO');
  });

  it('si 20 personas compiten por un hold vencido, gana una sola', async () => {
    const { club, cancha, clientes } = await crearEscenario(db, 21);
    const pedido = { clubId: club.id, canchaId: cancha.id, inicio: hora('20:00'), fin: hora('21:00') };
    const viejo = await crearHold(db, { ...pedido, clienteId: clientes[0]!.id });
    await vencer(viejo.id);

    const resultados = await Promise.allSettled(
      clientes.slice(1).map((c) => crearHold(db, { ...pedido, clienteId: c.id })),
    );
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('el barrido del worker con SKIP LOCKED expira solo los vencidos', async () => {
    const { club, cancha, clientes } = await crearEscenario(db, 2);
    const base = { clubId: club.id, canchaId: cancha.id };
    const vencido = await crearHold(db, {
      ...base,
      clienteId: clientes[0]!.id,
      inicio: hora('10:00'),
      fin: hora('11:00'),
    });
    const vigente = await crearHold(db, {
      ...base,
      clienteId: clientes[1]!.id,
      inicio: hora('12:00'),
      fin: hora('13:00'),
    });
    await vencer(vencido.id);

    const liberados = await db.execute<{ id: string }>(sql`
      WITH vencidos AS (
        SELECT id FROM turnos
         WHERE estado = 'PRE_RESERVADO' AND expira_en <= now() AND cancha_id = ${cancha.id}
         ORDER BY expira_en LIMIT 500
         FOR UPDATE SKIP LOCKED)
      UPDATE turnos t SET estado = 'EXPIRADO', expira_en = NULL
        FROM vencidos v WHERE t.id = v.id
      RETURNING t.id`);

    expect(liberados.map((r) => r.id)).toEqual([vencido.id]);
    const [sigue] = await db.select().from(turnos).where(eq(turnos.id, vigente.id));
    expect(sigue?.estado).toBe('PRE_RESERVADO');
  });

  it('pago tardío: revive el turno si el slot sigue libre, falla si alguien lo tomó', async () => {
    const { club, cancha, clientes } = await crearEscenario(db, 3);
    const base = { clubId: club.id, canchaId: cancha.id };
    const confirmar = (id: string) =>
      db.update(turnos).set({ estado: 'CONFIRMADO', expiraEn: null }).where(eq(turnos.id, id));

    // 18hs: venció, nadie lo tomó → el pago lo confirma
    const libre = await crearHold(db, {
      ...base,
      clienteId: clientes[0]!.id,
      inicio: hora('18:00'),
      fin: hora('19:00'),
    });
    await db.update(turnos).set({ estado: 'EXPIRADO', expiraEn: null }).where(eq(turnos.id, libre.id));
    await expect(confirmar(libre.id)).resolves.toBeDefined();

    // 20hs: venció y otro cliente lo reservó → el pago tardío choca (→ reembolso)
    const perdido = await crearHold(db, {
      ...base,
      clienteId: clientes[1]!.id,
      inicio: hora('20:00'),
      fin: hora('21:00'),
    });
    await vencer(perdido.id);
    await crearHold(db, { ...base, clienteId: clientes[2]!.id, inicio: hora('20:00'), fin: hora('21:00') });
    await expect(confirmar(perdido.id)).rejects.toSatisfy(esTurnoOcupado);
  });

  it('PRE_RESERVADO exige expira_en y los demás estados no lo admiten', async () => {
    const { club, cancha, clientes } = await crearEscenario(db);
    const t = await crearHold(db, {
      clubId: club.id,
      canchaId: cancha.id,
      clienteId: clientes[0]!.id,
      inicio: hora('20:00'),
      fin: hora('21:00'),
    });
    await expect(
      db.update(turnos).set({ estado: 'CONFIRMADO' }).where(eq(turnos.id, t.id)),
    ).rejects.toThrow();
  });
});

describe('triggers de turnos', () => {
  it('incrementa version y audita cada cambio de estado con su actor', async () => {
    const { club, cancha, clientes } = await crearEscenario(db);
    const t = await crearHold(db, {
      clubId: club.id,
      canchaId: cancha.id,
      clienteId: clientes[0]!.id,
      inicio: hora('20:00'),
      fin: hora('21:00'),
    });
    expect(t.version).toBe(0);

    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.actor', 'webhook:mp', true)`);
      await tx.update(turnos).set({ estado: 'CONFIRMADO', expiraEn: null }).where(eq(turnos.id, t.id));
    });

    const [actual] = await db.select().from(turnos).where(eq(turnos.id, t.id));
    expect(actual?.version).toBe(1);
    const eventos = await db
      .select({ de: turnosEventos.deEstado, a: turnosEventos.aEstado, actor: turnosEventos.actor })
      .from(turnosEventos)
      .where(eq(turnosEventos.turnoId, t.id))
      .orderBy(turnosEventos.id);
    expect(eventos).toEqual([
      { de: null, a: 'PRE_RESERVADO', actor: 'cliente' },
      { de: 'PRE_RESERVADO', a: 'CONFIRMADO', actor: 'webhook:mp' },
    ]);
  });
});
