import { canchas } from '@cancheria/db/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { aplicarEspecial, planPara, ServicioPlanes } from '../src/planes.ts';
import { type Contexto, crearContexto } from './helpers.ts';

let ctx: Contexto;
let planes: ServicioPlanes;
beforeEach(async () => {
  ctx = await crearContexto();
  planes = new ServicioPlanes({ db: ctx.db, reloj: ctx.ahora, urlWeb: 'https://cancheria.test' });
  return () => ctx.cerrar();
});
const agregarCanchas = (n: number) =>
  ctx.db.insert(canchas).values(
    Array.from({ length: n }, (_, i) => ({
      clubId: ctx.club.id,
      nombre: `Extra ${i + 1}`,
      jugadoresPorLado: 5,
      duracionTurnoMin: 60,
    })),
  );

describe('planes del abono', () => {
  const lista = [
    { nombre: 'Chico', desdeCanchas: 1, precio: 3_990_000 },
    { nombre: 'Mediano', desdeCanchas: 4, precio: 5_990_000 },
    { nombre: 'Grande', desdeCanchas: 7, precio: 7_990_000 },
  ];
  it('el plan sale de la cantidad de canchas', () => {
    expect(planPara(lista, 1)?.nombre).toBe('Chico');
    expect(planPara(lista, 3)?.nombre).toBe('Chico');
    expect(planPara(lista, 4)?.nombre).toBe('Mediano');
    expect(planPara(lista, 12)?.nombre).toBe('Grande');
  });

  it('descuento en % (redondeado a pesos) o precio fijo', () => {
    const e = { descuentoPct: 40, precioFijo: null, hasta: null, motivo: null };
    expect(aplicarEspecial(5_990_000, e)).toBe(3_594_000);
    expect(aplicarEspecial(3_990_000, { ...e, descuentoPct: 33 })).toBe(2_673_300);
    expect(aplicarEspecial(3_990_000, { ...e, descuentoPct: null, precioFijo: 1_000_000 })).toBe(1_000_000);
  });

  it('cuenta solo las canchas activas y cambia de plan al sumar canchas', async () => {
    expect(await planes.precioDe(ctx.club.id)).toMatchObject({
      canchas: 3,
      plan: { nombre: 'Chico' },
      precio: 3_990_000,
    });
    await agregarCanchas(2);
    expect(await planes.precioDe(ctx.club.id)).toMatchObject({
      canchas: 5,
      plan: { nombre: 'Mediano' },
      precio: 5_990_000,
    });
  });

  it('precio especial con vencimiento: después vuelve al precio del plan', async () => {
    await planes.ponerEspecial(ctx.club.id, { descuentoPct: 40, hasta: '2030-01-10', motivo: 'Fundador' });
    expect(await planes.precioDe(ctx.club.id)).toMatchObject({
      precioLista: 3_990_000,
      precio: 2_394_000,
      especial: { descuentoPct: 40, motivo: 'Fundador', hasta: '2030-01-10' },
    });
    ctx.setAhora(new Date('2030-01-11T09:00:00-03:00'));
    expect(await planes.precioDe(ctx.club.id)).toMatchObject({ precio: 3_990_000, especial: null });
    await expect(
      planes.ponerEspecial(ctx.club.id, { descuentoPct: 10, precioFijo: 1 }),
    ).rejects.toMatchObject({
      codigo: 'ESPECIAL_INVALIDO',
    });
    await planes.quitarEspecial(ctx.club.id);
  });

  it('los planes se editan; el primero arranca en 1 cancha', async () => {
    await planes.guardarPlanes([
      { nombre: 'Uno', desdeCanchas: 1, precio: 2_990_000 },
      { nombre: 'Varios', desdeCanchas: 2, precio: 4_490_000 },
    ]);
    expect((await planes.precioDe(ctx.club.id)).plan).toMatchObject({ nombre: 'Varios' });
    await expect(planes.guardarPlanes([{ nombre: 'X', desdeCanchas: 2, precio: 1 }])).rejects.toMatchObject({
      codigo: 'PLANES_INVALIDOS',
    });
  });
});
