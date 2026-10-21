import { clientes } from '@cancheria/db/schema';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AHORA, type Contexto, crearContexto, iso, pedido, reservar } from './helpers.ts';

let ctx: Contexto;
beforeAll(async () => {
  ctx = await crearContexto({ pool: 35 });
});
afterEach(() => ctx.setAhora(AHORA));
afterAll(() => ctx.cerrar());

describe('POST /public/clubs/:slug/reservas', () => {
  it('sábado a la noche: PRE_RESERVADO con seña del 50% y timer de 10 min', async () => {
    const res = await reservar(ctx, pedido(ctx.canchas.f5a.id, iso('2030-01-05', '20:00')));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      estado: 'PRE_RESERVADO',
      cancha: { nombre: 'Cancha 1' },
      inicio: iso('2030-01-05', '20:00'),
      fin: iso('2030-01-05', '21:00'),
      precioTotal: 4_500_000,
      montoSena: 2_250_000,
      saldoAPagar: 2_250_000,
      expiraEn: new Date(AHORA.getTime() + 10 * 60_000).toISOString(),
    });
    expect(res.json().codigo).toMatch(/^[0-9a-f]{32}$/);
  });

  it('siesta de semana: se confirma directo, sin seña', async () => {
    const res = await reservar(ctx, pedido(ctx.canchas.f5a.id, iso('2030-01-04', '14:00')));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      estado: 'CONFIRMADO',
      montoSena: 0,
      expiraEn: null,
      saldoAPagar: 3_000_000,
    });
  });

  it('30 personas a la vez por el mismo turno: 1 reserva, 29 reciben 409 con alternativas', async () => {
    const respuestas = await Promise.all(
      Array.from({ length: 30 }, () => reservar(ctx, pedido(ctx.canchas.f5b.id, iso('2030-01-05', '21:00')))),
    );
    const codigos = respuestas.map((r) => r.statusCode).sort();
    expect(codigos.filter((c) => c === 201)).toHaveLength(1);
    expect(codigos.filter((c) => c === 409)).toHaveLength(29);

    const rechazo = respuestas.find((r) => r.statusCode === 409)?.json();
    expect(rechazo.error.codigo).toBe('TURNO_OCUPADO');
    // La mejor alternativa: misma hora en la otra cancha F5
    expect(rechazo.error.detalle.alternativas[0]).toMatchObject({
      cancha: 'Cancha 1',
      inicio: iso('2030-01-05', '21:00'),
    });
    expect(rechazo.error.detalle.alternativas.length).toBeLessThanOrEqual(5);
  });

  it('doble clic (misma idempotencyKey): una sola reserva, la segunda respuesta es 200', async () => {
    const cuerpo = pedido(ctx.canchas.f5a.id, iso('2030-01-05', '10:00'));
    const [a, b] = await Promise.all([reservar(ctx, cuerpo), reservar(ctx, cuerpo)]);
    expect([a?.statusCode, b?.statusCode].sort()).toEqual([200, 201]);
    expect(a?.json().codigo).toBe(b?.json().codigo);
  });

  it('el mismo celular escrito de distintas formas es el mismo cliente (y no se le pisa el nombre)', async () => {
    const tel = ['11 6666-1234', '+54 9 11 6666 1234', '011 15 6666-1234'];
    for (const [i, telefono] of tel.entries()) {
      const res = await reservar(
        ctx,
        pedido(ctx.canchas.f5a.id, iso('2030-01-06', `1${i}:00`), { telefono, nombre: `Nombre ${i}` }),
      );
      expect(res.statusCode).toBe(201);
      expect(res.json().cliente.nombre).toBe('Nombre 0');
    }
    const filas = await ctx.db.select().from(clientes).where(eq(clientes.telefonoE164, '+5491166661234'));
    expect(filas).toHaveLength(1);
  });

  it('turno de madrugada: pertenece a la jornada del sábado', async () => {
    const res = await reservar(ctx, pedido(ctx.canchas.f5a.id, iso('2030-01-06', '01:00')));
    expect(res.statusCode).toBe(201);
  });

  describe('rechazos de negocio', () => {
    const esperar = async (cuerpo: ReturnType<typeof pedido>, status: number, codigo: string) => {
      const res = await reservar(ctx, cuerpo);
      expect(res.statusCode).toBe(status);
      expect(res.json().error.codigo).toBe(codigo);
      return res.json();
    };

    it('horario fuera de la grilla (20:30) → HORARIO_INVALIDO', async () => {
      await esperar(pedido(ctx.canchas.f5a.id, iso('2030-01-05', '20:30')), 422, 'HORARIO_INVALIDO');
    });

    it('horario ya pasado → HORARIO_PASADO', async () => {
      await esperar(pedido(ctx.canchas.f5a.id, iso('2030-01-04', '11:00')), 422, 'HORARIO_PASADO');
    });

    it('con seña pero empieza en minutos → RESERVA_MUY_CERCANA (con teléfono del club)', async () => {
      ctx.setAhora(new Date(iso('2030-01-04', '19:50')));
      const json = await esperar(
        pedido(ctx.canchas.f5a.id, iso('2030-01-04', '20:00')),
        422,
        'RESERVA_MUY_CERCANA',
      );
      expect(json.error.detalle.telefono).toBe('+5491155550000');
    });

    it('sin seña sí se puede reservar sobre la hora', async () => {
      ctx.setAhora(new Date(iso('2030-01-04', '14:55')));
      const res = await reservar(ctx, pedido(ctx.canchas.f5b.id, iso('2030-01-04', '15:00')));
      expect(res.json().estado).toBe('CONFIRMADO');
    });

    it('teléfono inválido → TELEFONO_INVALIDO', async () => {
      await esperar(
        pedido(ctx.canchas.f5a.id, iso('2030-01-05', '11:00'), { telefono: '4555-1234' }),
        422,
        'TELEFONO_INVALIDO',
      );
    });

    it('cancha de otro club o inexistente → CANCHA_NO_ENCONTRADA', async () => {
      await esperar(pedido(crypto.randomUUID(), iso('2030-01-05', '11:00')), 404, 'CANCHA_NO_ENCONTRADA');
    });

    it('DNI ya registrado con otro teléfono → DNI_CON_OTRO_TELEFONO', async () => {
      await reservar(ctx, pedido(ctx.canchas.f5a.id, iso('2030-01-05', '12:00'), { dni: '30.123.456' }));
      await esperar(
        pedido(ctx.canchas.f5a.id, iso('2030-01-05', '13:00'), { dni: '30123456' }),
        409,
        'DNI_CON_OTRO_TELEFONO',
      );
    });

    it('cliente bloqueado por el club → CLIENTE_BLOQUEADO', async () => {
      const cuerpo = pedido(ctx.canchas.f5a.id, iso('2030-01-05', '14:00'), { telefono: '+5491177770000' });
      await reservar(ctx, {
        ...cuerpo,
        inicio: iso('2030-01-05', '15:00'),
        idempotencyKey: crypto.randomUUID(),
      });
      await ctx.db
        .update(clientes)
        .set({ bloqueado: true })
        .where(eq(clientes.telefonoE164, '+5491177770000'));
      await esperar(cuerpo, 403, 'CLIENTE_BLOQUEADO');
    });

    it('cuerpo incompleto → 400 VALIDACION con el campo', async () => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/public/clubs/${ctx.slug}/reservas`,
        payload: { canchaId: ctx.canchas.f5a.id },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.detalle.map((d: { campo: string }) => d.campo)).toContain('cliente');
    });
  });
});

describe('GET /public/reservas/:codigo', () => {
  it('devuelve el comprobante', async () => {
    const creada = await reservar(ctx, pedido(ctx.canchas.f7.id, iso('2030-01-05', '19:30')));
    const res = await ctx.app.inject(`/public/reservas/${creada.json().codigo}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(creada.json());
  });

  it('404 si no existe, 400 si el código está mal formado', async () => {
    expect((await ctx.app.inject(`/public/reservas/${'0'.repeat(32)}`)).statusCode).toBe(404);
    expect((await ctx.app.inject('/public/reservas/abc')).statusCode).toBe(400);
  });
});
