import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AHORA, type Contexto, crearContexto, iso, pedido, reservar } from './helpers.ts';

let ctx: Contexto;
beforeAll(async () => {
  ctx = await crearContexto();
});
afterAll(() => ctx.cerrar());

interface Slot {
  inicio: string;
  fin: string;
  estado: string;
  precio: number;
  montoSena: number;
  requiereSena: boolean;
  minutosParaPagar: number | null;
}
interface Cancha {
  id: string;
  nombre: string;
  slots: Slot[];
}

const grilla = async (query: string) => {
  const res = await ctx.app.inject(`/public/clubs/${ctx.slug}/disponibilidad?${query}`);
  return { res, canchas: (res.json() as { canchas: Cancha[] }).canchas };
};
const slot = (c: Cancha | undefined, inicio: string) => c?.slots.find((s) => s.inicio === inicio);

describe('GET /public/clubs/:slug', () => {
  it('devuelve el club y sus canchas activas', async () => {
    const res = await ctx.app.inject(`/public/clubs/${ctx.slug}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      slug: ctx.slug,
      nombre: 'La Canchita F5',
      canchas: [
        { nombre: 'Cancha 1', jugadoresPorLado: 5 },
        { nombre: 'Cancha 2', jugadoresPorLado: 5 },
        { nombre: 'Cancha 3', jugadoresPorLado: 7, duracionMin: 90 },
      ],
    });
  });

  it('404 si el slug no existe', async () => {
    const res = await ctx.app.inject('/public/clubs/no-existe');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.codigo).toBe('CLUB_NO_ENCONTRADO');
  });
});

describe('GET /public/clubs/:slug/disponibilidad', () => {
  it('sábado F5: 09:00 a 02:00 del domingo, valle/pico y seña del 50%', async () => {
    const { res, canchas } = await grilla('fecha=2030-01-05&jugadores=5');
    expect(res.statusCode).toBe(200);
    expect(canchas.map((c) => c.nombre)).toEqual(['Cancha 1', 'Cancha 2']);
    const [c1] = canchas;
    expect(c1?.slots).toHaveLength(17);
    expect(c1?.slots[0]).toEqual({
      inicio: iso('2030-01-05', '09:00'),
      fin: iso('2030-01-05', '10:00'),
      estado: 'LIBRE',
      precio: 3_000_000,
      montoSena: 1_500_000,
      requiereSena: true,
      minutosParaPagar: 10,
    });
    expect(slot(c1, iso('2030-01-05', '20:00'))).toMatchObject({ precio: 4_500_000, montoSena: 2_250_000 });
    expect(c1?.slots.at(-1)?.fin).toBe(iso('2030-01-06', '02:00'));
  });

  it('F7: turnos de 90 min con su tarifa propia', async () => {
    const { canchas } = await grilla('fecha=2030-01-05&jugadores=7');
    expect(canchas).toHaveLength(1);
    expect(slot(canchas[0], iso('2030-01-05', '19:30'))).toMatchObject({
      fin: iso('2030-01-05', '21:00'),
      precio: 7_000_000,
    });
  });

  it('hoy (viernes 12:00): lo anterior está PASADO y la siesta no pide seña', async () => {
    const { canchas } = await grilla('fecha=2030-01-04&jugadores=5');
    const c1 = canchas[0];
    expect(slot(c1, iso('2030-01-04', '11:00'))?.estado).toBe('PASADO');
    expect(slot(c1, iso('2030-01-04', '12:00'))?.estado).toBe('LIBRE');
    expect(slot(c1, iso('2030-01-04', '14:00'))).toMatchObject({
      requiereSena: false,
      montoSena: 0,
      precio: 3_000_000,
    });
    expect(slot(c1, iso('2030-01-04', '17:00'))?.requiereSena).toBe(true);
  });

  it('una reserva ocupa solo su cancha y su horario', async () => {
    const res = await reservar(ctx, pedido(ctx.canchas.f5a.id, iso('2030-01-12', '20:00')));
    expect(res.statusCode).toBe(201);
    const { canchas } = await grilla('fecha=2030-01-12&jugadores=5');
    expect(slot(canchas[0], iso('2030-01-12', '20:00'))?.estado).toBe('OCUPADO');
    expect(slot(canchas[0], iso('2030-01-12', '21:00'))?.estado).toBe('LIBRE');
    expect(slot(canchas[1], iso('2030-01-12', '20:00'))?.estado).toBe('LIBRE');
  });

  it('un hold vencido se muestra libre aunque el worker no haya pasado', async () => {
    const res = await reservar(ctx, pedido(ctx.canchas.f5b.id, iso('2030-01-12', '22:00')));
    expect(res.json().estado).toBe('PRE_RESERVADO');

    ctx.setAhora(new Date(AHORA.getTime() + 11 * 60_000)); // sábado: timer de 10 min
    try {
      const { canchas } = await grilla('fecha=2030-01-12&jugadores=5');
      expect(slot(canchas[1], iso('2030-01-12', '22:00'))?.estado).toBe('LIBRE');
      const comprobante = await ctx.app.inject(`/public/reservas/${res.json().codigo}`);
      expect(comprobante.json().estado).toBe('EXPIRADO');
    } finally {
      ctx.setAhora(AHORA);
    }
  });

  it('valida la fecha: formato (400) y rango de anticipación (422)', async () => {
    expect((await grilla('fecha=05/01/2030')).res.statusCode).toBe(400);
    const lejos = await grilla('fecha=2030-03-01');
    expect(lejos.res.statusCode).toBe(422);
    expect(lejos.res.json().error.codigo).toBe('FECHA_FUERA_DE_RANGO');
    expect((await grilla('fecha=2030-01-02')).res.statusCode).toBe(422);
  });
});
