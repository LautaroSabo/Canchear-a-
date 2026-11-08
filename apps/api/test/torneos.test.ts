import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Contexto, crearContexto, iso, panel, usuarioPanel } from './helpers.ts';

let ctx: Contexto;
let admin: string;
let recepcion: string;
beforeAll(async () => {
  ctx = await crearContexto();
  admin = (await usuarioPanel(ctx, 'ADMIN')).cookie;
  recepcion = (await usuarioPanel(ctx, 'RECEPCION')).cookie;
});
afterAll(() => ctx.cerrar());

const cuerpo = (x: Record<string, unknown> = {}) => ({
  nombre: 'Copa Otoño',
  jugadoresPorLado: 5,
  inscripcionOnline: true,
  cantidadGrupos: 1,
  idaYVuelta: false,
  clasificanPorGrupo: 2,
  dias: [3],
  horaDesde: '21:00',
  horaHasta: '23:00',
  canchaIds: [ctx.canchas.f5a!.id],
  fechaInicio: '2030-01-07',
  duracionMin: 60,
  ...x,
});

describe('torneos por la API', () => {
  it('alta, inscripción online, aprobación, sorteo, resultados y vista pública', async () => {
    expect((await panel(ctx, recepcion, 'POST', '/torneos', cuerpo())).statusCode).toBe(403);
    const alta = await panel(ctx, admin, 'POST', '/torneos', cuerpo());
    expect(alta.statusCode).toBe(201);
    const { id, slug } = alta.json();

    for (const nombre of ['Rojos', 'Azules', 'Verdes']) {
      const r = await panel(ctx, admin, 'POST', `/torneos/${id}/equipos`, {
        nombre,
        delegadoNombre: `Delegado ${nombre}`,
        delegadoTelefono: '11 5000-1111',
      });
      expect(r.statusCode).toBe(201);
    }
    const insc = await ctx.app.inject({
      method: 'POST',
      url: `/public/clubs/${ctx.slug}/torneos/${slug}/inscripcion`,
      payload: { nombre: 'Online FC', delegadoNombre: 'Ana', delegadoTelefono: '11 5000-2222' },
    });
    expect(insc.statusCode).toBe(201);

    const vista = (await panel(ctx, recepcion, 'GET', `/torneos/${id}`)).json();
    const pendiente = vista.equipos.find((e: { nombre: string }) => e.nombre === 'Online FC');
    expect(pendiente).toMatchObject({ estado: 'PENDIENTE', delegadoTelefono: '+5491150002222' });
    expect(
      (await panel(ctx, admin, 'PATCH', `/torneos/${id}/equipos/${pendiente.id}`, { estado: 'APROBADO' }))
        .statusCode,
    ).toBe(204);

    const lista = (await ctx.app.inject(`/public/clubs/${ctx.slug}/torneos`)).json();
    expect(lista).toMatchObject([{ slug, nombre: 'Copa Otoño', equipos: 4, estado: 'INSCRIPCION' }]);
    expect(lista[0].pendientes).toBeUndefined();

    const inicio = await panel(ctx, admin, 'POST', `/torneos/${id}/iniciar`, {});
    expect(inicio.statusCode).toBe(200);
    const v = inicio.json();
    expect(v.torneo.estado).toBe('EN_CURSO');
    // 4 equipos, 2 por miércoles (21 y 22 h): 3 fechas.
    expect(v.partidos).toHaveLength(6);
    expect(v.partidos[0]).toMatchObject({ fecha: 1, inicio: iso('2030-01-09', '21:00'), cancha: 'Cancha 1' });

    // La recepción carga resultados.
    let ultima = v;
    for (const p of v.partidos) {
      const r = await panel(ctx, recepcion, 'PUT', `/torneos/${id}/partidos/${p.id}/resultado`, {
        golesLocal: 2,
        golesVisitante: 0,
      });
      expect(r.statusCode).toBe(200);
      ultima = r.json();
    }
    expect(ultima.eliminacionPendiente).toBe(true);
    const elim = await panel(ctx, admin, 'POST', `/torneos/${id}/eliminacion`, {});
    expect(elim.statusCode).toBe(200);
    const final = elim.json().partidos.find((p: { fase: string }) => p.fase === 'ELIMINACION');
    expect(final).toMatchObject({ ronda: 1, estado: 'PROGRAMADO' });
    expect(final.local).not.toBeNull();

    const pub = await ctx.app.inject(`/public/clubs/${ctx.slug}/torneos/${slug}`);
    expect(pub.statusCode).toBe(200);
    expect(pub.json().grupos[0].tabla).toHaveLength(4);
    expect(pub.body).not.toContain('delegado');
    expect(pub.body).not.toContain('5000');
  });

  it('validaciones: slug de torneo inexistente, cuerpo inválido', async () => {
    expect((await ctx.app.inject(`/public/clubs/${ctx.slug}/torneos/no-existe`)).statusCode).toBe(404);
    expect((await panel(ctx, admin, 'POST', '/torneos', cuerpo({ dias: [] }))).statusCode).toBe(400);
  });
});
