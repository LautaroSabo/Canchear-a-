import { describe, expect, it } from 'vitest';
import { ErrorMp, PasarelaMpHttp } from '../src/mercadopago/pasarela.ts';
import { CanalWhatsApp } from '../src/notificaciones/canales.ts';

/** fetch falso que registra cada request y responde lo que se le indique. */
function fetchFalso(respuestas: { status?: number; json?: unknown }[]) {
  const llamadas: { url: string; init: RequestInit; cuerpo: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, init, cuerpo: init.body ? JSON.parse(String(init.body)) : undefined });
    const r = respuestas.shift() ?? {};
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, llamadas };
}

describe('PasarelaMpHttp (requests a la API de Mercado Pago)', () => {
  it('crea la preferencia con vencimiento, binary_mode, sin efectivo e idempotencia', async () => {
    const { fn, llamadas } = fetchFalso([
      { json: { id: 'pref-1', init_point: 'https://mp/checkout/pref-1' } },
    ]);
    const mp = new PasarelaMpHttp(fn);
    const r = await mp.crearPreferencia('TOKEN', {
      titulo: 'Seña Cancha 1',
      monto: 2_250_050,
      moneda: 'ARS',
      referenciaExterna: 'turno-1',
      vence: new Date('2030-01-04T15:10:00Z'),
      urlNotificacion: 'https://api/webhooks/mercadopago/club',
      urlRetorno: 'https://web/r/abc',
      idempotencia: 'pref-turno-1',
    });
    expect(r).toEqual({ id: 'pref-1', urlCheckout: 'https://mp/checkout/pref-1' });

    const [{ url, init, cuerpo }] = llamadas as [(typeof llamadas)[0]];
    expect(url).toBe('https://api.mercadopago.com/checkout/preferences');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer TOKEN',
      'x-idempotency-key': 'pref-turno-1',
    });
    expect(cuerpo).toMatchObject({
      items: [{ title: 'Seña Cancha 1', quantity: 1, unit_price: 22500.5, currency_id: 'ARS' }],
      external_reference: 'turno-1',
      notification_url: 'https://api/webhooks/mercadopago/club',
      back_urls: { success: 'https://web/r/abc', pending: 'https://web/r/abc', failure: 'https://web/r/abc' },
      auto_return: 'approved',
      binary_mode: true,
      payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }] },
      expires: true,
      expiration_date_to: '2030-01-04T15:10:00.000+00:00',
    });
  });

  it('obtiene un pago y convierte el monto a centavos; 404 → null', async () => {
    const { fn, llamadas } = fetchFalso([
      {
        json: {
          id: 123,
          status: 'approved',
          transaction_amount: 22500.5,
          currency_id: 'ARS',
          external_reference: 'turno-1',
          date_approved: '2030-01-04T15:05:00.000-03:00',
        },
      },
      { status: 404 },
    ]);
    const mp = new PasarelaMpHttp(fn);
    expect(await mp.obtenerPago('T', '123')).toMatchObject({
      id: '123',
      estado: 'approved',
      monto: 2_250_050,
      referenciaExterna: 'turno-1',
      aprobadoEn: new Date('2030-01-04T18:05:00Z'),
    });
    expect(llamadas[0]?.url).toBe('https://api.mercadopago.com/v1/payments/123');
    expect(await mp.obtenerPago('T', '999')).toBeNull();
  });

  it('busca pagos por referencia externa y reembolsa con idempotencia', async () => {
    const { fn, llamadas } = fetchFalso([{ json: { results: [] } }, { json: { id: 77 } }]);
    const mp = new PasarelaMpHttp(fn);
    await mp.buscarPagos('T', 'turno-1');
    expect(llamadas[0]?.url).toBe(
      'https://api.mercadopago.com/v1/payments/search?external_reference=turno-1&sort=date_created&criteria=desc',
    );
    expect(await mp.reembolsar('T', '123', 'reembolso-1')).toEqual({ id: '77' });
    expect(llamadas[1]?.url).toBe('https://api.mercadopago.com/v1/payments/123/refunds');
    expect(llamadas[1]?.init.headers).toMatchObject({ 'x-idempotency-key': 'reembolso-1' });
  });

  it('errores de MP se propagan con el status', async () => {
    const { fn } = fetchFalso([{ status: 401, json: { message: 'invalid token' } }]);
    await expect(new PasarelaMpHttp(fn).obtenerPago('MAL', '1')).rejects.toBeInstanceOf(ErrorMp);
  });
});

describe('CanalWhatsApp (Cloud API de Meta)', () => {
  it('manda la plantilla aprobada con los parámetros en orden', async () => {
    const { fn, llamadas } = fetchFalso([{ json: { messages: [{ id: 'wamid' }] } }]);
    const canal = new CanalWhatsApp({ token: 'WA', phoneNumberId: '555', fetchFn: fn });
    await canal.enviar('+5491155551234', 'reserva_confirmada', {
      link: 'https://web/r/x',
      club: 'La Canchita',
      hora: '20:00',
      cancha: 'Cancha 1',
      fecha: 'sáb 05/01',
    });
    const [{ url, init, cuerpo }] = llamadas as [(typeof llamadas)[0]];
    expect(url).toBe('https://graph.facebook.com/v23.0/555/messages');
    expect(init.headers).toMatchObject({ authorization: 'Bearer WA' });
    expect(cuerpo).toEqual({
      messaging_product: 'whatsapp',
      to: '5491155551234',
      type: 'template',
      template: {
        name: 'reserva_confirmada',
        language: { code: 'es_AR' },
        components: [
          {
            type: 'body',
            parameters: ['La Canchita', 'Cancha 1', 'sáb 05/01', '20:00', 'https://web/r/x'].map((text) => ({
              type: 'text',
              text,
            })),
          },
        ],
      },
    });
  });

  it('un error de Meta hace fallar el envío (y el despachador reintenta)', async () => {
    const { fn } = fetchFalso([{ status: 400, json: { error: { message: 'template not found' } } }]);
    const canal = new CanalWhatsApp({ token: 'WA', phoneNumberId: '555', fetchFn: fn });
    await expect(canal.enviar('+549111', 'reserva_expirada', {})).rejects.toThrow(/WhatsApp 400/);
  });
});
