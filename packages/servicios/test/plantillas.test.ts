import { describe, expect, it } from 'vitest';
import { PlantillasMeta } from '../src/notificaciones/meta-plantillas.ts';
import { cuerpoMeta, PLANTILLAS, type Plantilla, problemasMeta } from '../src/notificaciones/plantillas.ts';

describe('plantillas de WhatsApp', () => {
  it.each(Object.keys(PLANTILLAS) as Plantilla[])('%s cumple las reglas de revisión de Meta', (p) => {
    expect(problemasMeta(cuerpoMeta(p))).toEqual([]);
    expect(PLANTILLAS[p].ejemplo).toHaveLength(PLANTILLAS[p].parametros.length);
    expect(PLANTILLAS[p].ejemplo.every((v) => v.trim().length > 0)).toBe(true);
  });

  it('el validador detecta lo que Meta rechaza', () => {
    expect(problemasMeta('Hola {{1}}, tu comprobante: {{2}}')).toContain(
      'no puede terminar con una variable',
    );
    expect(problemasMeta('{{1}} confirmó tu turno de hoy')).toContain('no puede empezar con una variable');
    expect(problemasMeta('Tu turno en {{1}} {{2}} quedó confirmado hoy')).toContain(
      'dos variables seguidas, sin palabras entre ellas',
    );
    expect(problemasMeta('Tu turno {{1}} y {{3}} quedó confirmado para hoy')).toContain(
      'las variables tienen que ir {{1}}, {{2}}… en orden y sin saltos',
    );
    expect(problemasMeta('Hola {{1}} y {{2}} chau')).toContain('demasiadas variables para tan poco texto');
  });

  it('cuerpo con variables numeradas', () => {
    expect(cuerpoMeta('reserva_expirada')).toBe(
      '⌛ Venció el plazo para confirmar tu turno en {{1}} del {{2}} a las {{3}}, y la cancha quedó libre. Si querés, podés reservar de nuevo.',
    );
  });
});

describe('alta en Meta', () => {
  it('crea solo las que faltan, con categoría utilidad y ejemplos, y devuelve el estado', async () => {
    const cargadas = [
      { name: 'reserva_confirmada', language: 'es_AR', status: 'APPROVED', category: 'UTILITY' },
      {
        name: 'reserva_expirada',
        language: 'es_AR',
        status: 'REJECTED',
        category: 'UTILITY',
        rejected_reason: 'INVALID_FORMAT',
      },
      { name: 'reserva_cancelada', language: 'en_US', status: 'APPROVED', category: 'UTILITY' },
    ];
    const posts: { url: string; cuerpo: Record<string, unknown>; auth: string | null }[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (init?.method === 'POST') {
        const cuerpo = JSON.parse(String(init.body));
        posts.push({ url, cuerpo, auth: headers.get('authorization') });
        cargadas.push({
          name: cuerpo.name,
          language: cuerpo.language,
          status: 'PENDING',
          category: 'UTILITY',
        });
        return new Response(JSON.stringify({ id: '1', status: 'PENDING' }));
      }
      return new Response(JSON.stringify({ data: cargadas }));
    }) as typeof fetch;

    const meta = new PlantillasMeta({ token: 'tok', wabaId: '123', fetchFn });
    const r = await meta.crearFaltantes();
    expect(r.creadas).toEqual([
      'reserva_cancelada',
      'pago_reembolsado',
      'transferencia_rechazada',
      'oferta_lista_espera',
      'turno_fijo_creado',
    ]);
    expect(posts[0]).toMatchObject({
      url: 'https://graph.facebook.com/v23.0/123/message_templates',
      auth: 'Bearer tok',
      cuerpo: {
        name: 'reserva_cancelada',
        language: 'es_AR',
        category: 'UTILITY',
        components: [{ type: 'BODY', example: { body_text: [PLANTILLAS.reserva_cancelada.ejemplo] } }],
      },
    });
    expect(r.estados.find((e) => e.nombre === 'reserva_expirada')).toMatchObject({
      estado: 'REJECTED',
      motivoRechazo: 'INVALID_FORMAT',
    });
  });

  it('un error de Meta se muestra con su mensaje', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token' } }), {
        status: 401,
      })) as unknown as typeof fetch;
    await expect(new PlantillasMeta({ token: 'x', wabaId: '1', fetchFn }).estados()).rejects.toThrow(
      'Meta 401: Invalid OAuth access token',
    );
  });
});
