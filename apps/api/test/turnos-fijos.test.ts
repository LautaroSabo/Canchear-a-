import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Contexto, crearContexto, iso, panel, usuarioPanel } from './helpers.ts';

let ctx: Contexto;
let recepcion: string;
beforeAll(async () => {
  ctx = await crearContexto();
  recepcion = (await usuarioPanel(ctx, 'RECEPCION')).cookie;
});
afterAll(() => ctx.cerrar());

const cuerpo = (x: Record<string, unknown> = {}) => ({
  canchaId: ctx.canchas.f5b!.id,
  cliente: { nombre: 'Los Pibes', telefono: '11 5000-4321' },
  diaSemana: 3,
  horaInicio: '21:00',
  frecuenciaSemanas: 1,
  vigenteDesde: '2030-01-01',
  ...x,
});

describe('turnos fijos', () => {
  it('vista previa, alta, y se ve como ocupado en la grilla pública', async () => {
    const prev = await panel(ctx, recepcion, 'POST', '/turnos-fijos/previsualizar', cuerpo());
    expect(prev.statusCode).toBe(200);
    expect(prev.json()).toMatchObject({ vigenteDesde: '2030-01-09', duracionMin: 60 });
    expect(prev.json().ocurrencias).toHaveLength(8);
    expect(prev.json().ocurrencias[0]).toMatchObject({
      fecha: '2030-01-09',
      inicio: iso('2030-01-09', '21:00'),
      estado: 'LIBRE',
      precio: 4_500_000,
    });

    const res = await panel(ctx, recepcion, 'POST', '/turnos-fijos', cuerpo({ nota: 'Pagan por mes' }));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ creados: 8, omitidos: [] });

    const disp = await ctx.app.inject(
      `/public/clubs/${ctx.slug}/disponibilidad?fecha=2030-01-09&jugadores=5`,
    );
    const c2 = disp.json().canchas.find((c: { nombre: string }) => c.nombre === 'Cancha 2');
    expect(c2.slots.find((s: { inicio: string }) => s.inicio === iso('2030-01-09', '21:00')).estado).toBe(
      'OCUPADO',
    );

    const agenda = await panel(ctx, recepcion, 'GET', '/agenda?fecha=2030-01-09');
    expect(JSON.stringify(agenda.json())).toContain('"origen":"FIJO"');

    const lista = (await panel(ctx, recepcion, 'GET', '/turnos-fijos')).json();
    expect(lista).toMatchObject([
      {
        id: res.json().id,
        cancha: 'Cancha 2',
        diaSemana: 3,
        horaInicio: '21:00',
        nota: 'Pagan por mes',
        proximo: iso('2030-01-09', '21:00'),
        cliente: { nombre: 'Los Pibes', telefono: '+5491150004321' },
        omitidos: [],
      },
    ]);
  });

  it('choque: fecha omitida, contador para el menú, descartar', async () => {
    const otro = await panel(ctx, recepcion, 'POST', '/turnos', {
      canchaId: ctx.canchas.f5a!.id,
      inicio: iso('2030-01-11', '20:00'),
      cliente: { nombre: 'Ocupante', telefono: '11 5000-1111' },
    });
    expect(otro.statusCode).toBe(201);
    const res = await panel(
      ctx,
      recepcion,
      'POST',
      '/turnos-fijos',
      cuerpo({
        canchaId: ctx.canchas.f5a!.id,
        diaSemana: 5,
        horaInicio: '20:00',
        cliente: { nombre: 'Viernes', telefono: '11 5000-2222' },
      }),
    );
    expect(res.json().omitidos).toEqual([{ fecha: '2030-01-11', motivo: 'OCUPADO' }]);
    expect((await panel(ctx, recepcion, 'GET', '/turnos-fijos/pendientes')).json()).toEqual({ omitidos: 1 });

    const id = res.json().id;
    const reintento = await panel(
      ctx,
      recepcion,
      'POST',
      `/turnos-fijos/${id}/omitidos/2030-01-11/reintentar`,
    );
    expect(reintento.json()).toEqual({ creado: false, motivo: 'OCUPADO' });
    expect(
      (await panel(ctx, recepcion, 'DELETE', `/turnos-fijos/${id}/omitidos/2030-01-11`)).statusCode,
    ).toBe(204);
    expect((await panel(ctx, recepcion, 'GET', '/turnos-fijos/pendientes')).json()).toEqual({ omitidos: 0 });
  });

  it('precio pactado y baja', async () => {
    const res = await panel(
      ctx,
      recepcion,
      'POST',
      '/turnos-fijos',
      cuerpo({
        diaSemana: 1,
        horaInicio: '19:00',
        precioPactado: 4_000_000,
        cliente: { nombre: 'Lunes', telefono: '11 5000-3333' },
      }),
    );
    const id = res.json().id;
    expect(
      (await panel(ctx, recepcion, 'PATCH', `/turnos-fijos/${id}`, { precioPactado: 3_900_000 })).json(),
    ).toEqual({
      actualizados: 8,
    });
    const baja = await panel(ctx, recepcion, 'POST', `/turnos-fijos/${id}/baja`, { desde: '2030-02-01' });
    expect(baja.json()).toEqual({ cancelados: 4, conPagos: 0 });
    const f = (await panel(ctx, recepcion, 'GET', '/turnos-fijos'))
      .json()
      .find((x: { id: string }) => x.id === id);
    expect(f).toMatchObject({ vigenteHasta: '2030-01-31', precioPactado: 3_900_000 });
  });

  it('validaciones y aislamiento entre clubs', async () => {
    const mal = await panel(ctx, recepcion, 'POST', '/turnos-fijos', cuerpo({ frecuenciaSemanas: 3 }));
    expect(mal.statusCode).toBe(400);
    const vigencia = await panel(
      ctx,
      recepcion,
      'POST',
      '/turnos-fijos',
      cuerpo({ vigenteHasta: '2029-12-31' }),
    );
    expect(vigencia.json().error.codigo).toBe('VIGENCIA_INVALIDA');
    const ajeno = await panel(
      ctx,
      recepcion,
      'POST',
      '/turnos-fijos/00000000-0000-4000-8000-000000000000/baja',
      {
        desde: '2030-02-01',
      },
    );
    expect(ajeno.statusCode).toBe(404);
  });
});
