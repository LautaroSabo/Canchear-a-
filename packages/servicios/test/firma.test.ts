import { describe, expect, it } from 'vitest';
import { firmarWebhook, firmaWebhookValida, manifiestoWebhook } from '../src/mercadopago/firma.ts';

describe('firma de webhooks de Mercado Pago', () => {
  it('arma el manifiesto en el orden documentado y omite lo que falta', () => {
    expect(manifiestoWebhook('123', 'req-1', '1700')).toBe('id:123;request-id:req-1;ts:1700;');
    expect(manifiestoWebhook(undefined, 'req-1', '1700')).toBe('request-id:req-1;ts:1700;');
    expect(manifiestoWebhook('ORD01ABC', undefined, '1700')).toBe('id:ord01abc;ts:1700;');
  });

  it('acepta una firma correcta y rechaza secreto, id o request-id distintos', () => {
    const firma = firmarWebhook('secreto', '123', 'req-1', '1700');
    const base = { secreto: 'secreto', firma, requestId: 'req-1', dataId: '123' };
    expect(firmaWebhookValida(base)).toBe(true);
    expect(firmaWebhookValida({ ...base, secreto: 'otro' })).toBe(false);
    expect(firmaWebhookValida({ ...base, dataId: '124' })).toBe(false);
    expect(firmaWebhookValida({ ...base, requestId: 'req-2' })).toBe(false);
  });

  it('rechaza headers ausentes o mal formados', () => {
    const base = { secreto: 's', requestId: 'r', dataId: '1' };
    expect(firmaWebhookValida({ ...base, firma: undefined })).toBe(false);
    expect(firmaWebhookValida({ ...base, firma: 'basura' })).toBe(false);
    expect(firmaWebhookValida({ ...base, firma: 'ts=1,v1=zz' })).toBe(false);
  });
});
