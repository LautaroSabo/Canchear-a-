import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Valida el header `x-signature` de un webhook de Mercado Pago:
 *   x-signature: ts=1704908010,v1=<hmac hex>
 * El manifiesto firmado es `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, donde
 * data.id sale del query string (en minúsculas si es alfanumérico) y las partes
 * ausentes se omiten. HMAC-SHA256 con la clave secreta de webhooks del club, en hex.
 *
 * Es una defensa adicional: el webhook igual consulta el pago a la API de MP antes de
 * hacer nada, así que una notificación falsificada no puede confirmar un turno.
 */
export function firmaWebhookValida(p: {
  secreto: string;
  firma: string | undefined;
  requestId: string | undefined;
  dataId: string | undefined;
}): boolean {
  if (!p.firma) return false;
  const partes = Object.fromEntries(
    p.firma.split(',').map((x) => {
      const [k, ...v] = x.trim().split('=');
      return [k, v.join('=')];
    }),
  );
  const { ts, v1 } = partes as { ts?: string; v1?: string };
  if (!ts || !v1) return false;

  const manifiesto = manifiestoWebhook(p.dataId, p.requestId, ts);
  const esperado = createHmac('sha256', p.secreto).update(manifiesto).digest();
  const recibido = Buffer.from(v1, 'hex');
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado);
}

export function manifiestoWebhook(dataId: string | undefined, requestId: string | undefined, ts: string) {
  let m = '';
  if (dataId) m += `id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};`;
  if (requestId) m += `request-id:${requestId};`;
  m += `ts:${ts};`;
  return m;
}

/** Para tests y para simular notificaciones en desarrollo. */
export function firmarWebhook(secreto: string, dataId: string, requestId: string, ts = String(Date.now())) {
  const v1 = createHmac('sha256', secreto)
    .update(manifiestoWebhook(dataId, requestId, ts))
    .digest('hex');
  return `ts=${ts},v1=${v1}`;
}
