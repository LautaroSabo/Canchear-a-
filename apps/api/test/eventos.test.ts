import { afterAll, beforeAll, expect, it } from 'vitest';
import { type Contexto, crearContexto, iso, pedido, reservar, usuarioPanel } from './helpers.ts';

let ctx: Contexto;
let base: string;
beforeAll(async () => {
  ctx = await crearContexto();
  base = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(() => ctx.cerrar());

it('SSE: una reserva nueva llega en tiempo real a quien mira la grilla, sin datos personales', async () => {
  const control = new AbortController();
  const res = await fetch(`${base}/public/clubs/${ctx.slug}/eventos`, {
    signal: control.signal,
    headers: { origin: 'http://localhost:3000' },
  });
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');

  const lector = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const recibido = (async () => {
    let buffer = '';
    while (!buffer.includes('event: turno')) {
      const { value, done } = await lector.read();
      if (done) break;
      buffer += value;
    }
    return buffer;
  })();

  await new Promise((r) => setTimeout(r, 100)); // que el stream quede suscripto
  await reservar(ctx, pedido(ctx.canchas.f5a.id, iso('2030-01-05', '18:00')));

  const texto = await recibido;
  await lector.cancel();
  control.abort();
  const data = JSON.parse(texto.split('event: turno\ndata: ')[1]!.split('\n')[0]!);
  expect(data).toEqual({
    canchaId: ctx.canchas.f5a.id,
    inicio: iso('2030-01-05', '18:00'),
    estado: 'PRE_RESERVADO',
  });
});

it('no recibe eventos de otros clubs', async () => {
  const otro = await crearContexto();
  try {
    const control = new AbortController();
    const res = await fetch(`${base}/public/clubs/${ctx.slug}/eventos`, { signal: control.signal });
    const lector = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    await lector.read(); // "retry: 3000"
    await reservar(otro, pedido(otro.canchas.f5a.id, iso('2030-01-05', '18:00')));
    let timer: NodeJS.Timeout | undefined;
    const siguiente = await Promise.race([
      lector.read(),
      new Promise((r) => {
        timer = setTimeout(() => r('nada'), 500);
      }),
    ]);
    clearTimeout(timer);
    await lector.cancel();
    control.abort();
    expect(siguiente).toBe('nada');
  } finally {
    await otro.cerrar();
  }
});

it('panel: el SSE del club exige sesión y transmite los cambios', async () => {
  const sinSesion = await fetch(`${base}/admin/clubs/${ctx.club.id}/eventos`);
  expect(sinSesion.status).toBe(401);
  await sinSesion.body?.cancel();

  const { cookie } = await usuarioPanel(ctx, 'RECEPCION');
  const control = new AbortController();
  const res = await fetch(`${base}/admin/clubs/${ctx.club.id}/eventos`, {
    signal: control.signal,
    headers: { cookie },
  });
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const lector = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const recibido = (async () => {
    let buffer = '';
    while (!buffer.includes('event: turno')) {
      const { value, done } = await lector.read();
      if (done) break;
      buffer += value;
    }
    return buffer;
  })();
  await new Promise((r) => setTimeout(r, 100));
  await reservar(ctx, pedido(ctx.canchas.f5b.id, iso('2030-01-05', '19:00')));
  expect(await recibido).toContain('"estado":"PRE_RESERVADO"');
  await lector.cancel();
  control.abort();
});
