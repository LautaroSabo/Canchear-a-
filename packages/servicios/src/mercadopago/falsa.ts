import { randomUUID } from 'node:crypto';
import type { DatosPreferencia, PagoMp, PasarelaMp } from './pasarela.ts';

/**
 * Mercado Pago en memoria para tests: registra lo que se le pide y permite simular que
 * un cliente pagó (`pagar`). Respeta la idempotencia de preferencias y reembolsos.
 */
export class PasarelaMpFalsa implements PasarelaMp {
  readonly preferencias = new Map<string, DatosPreferencia & { id: string; token: string }>();
  readonly pagos = new Map<string, PagoMp>();
  readonly reembolsos: { pagoId: string; idempotencia: string; id: string }[] = [];
  /** Si se setea, la próxima llamada a `reembolsar` falla (para probar reintentos). */
  fallarProximoReembolso = false;
  /** Si se setea, la próxima preferencia falla (MP caído). */
  fallarProximaPreferencia = false;
  /** Los ids de pago de MP son únicos globalmente: compartido entre instancias. */
  private static secuencia = Date.now();

  async crearPreferencia(token: string, datos: DatosPreferencia) {
    if (this.fallarProximaPreferencia) {
      this.fallarProximaPreferencia = false;
      throw new Error('fetch failed (simulado)');
    }
    const previa = [...this.preferencias.values()].find((p) => p.idempotencia === datos.idempotencia);
    const pref = previa ?? { ...datos, id: `pref-${randomUUID()}`, token };
    this.preferencias.set(pref.id, pref);
    return { id: pref.id, urlCheckout: `https://mp.test/checkout/${pref.id}` };
  }

  /** Simula que el cliente pagó una preferencia (o cualquier monto con esa referencia). */
  pagar(
    referenciaExterna: string,
    monto: number,
    estado: PagoMp['estado'] = 'approved',
    moneda = 'ARS',
  ): PagoMp {
    const pago: PagoMp = {
      id: String(PasarelaMpFalsa.secuencia++),
      estado,
      monto,
      moneda,
      referenciaExterna,
      aprobadoEn: estado === 'approved' ? new Date() : null,
      bruto: { simulado: true },
    };
    this.pagos.set(pago.id, pago);
    return pago;
  }

  async obtenerPago(_token: string, pagoId: string) {
    return this.pagos.get(pagoId) ?? null;
  }

  async buscarPagos(_token: string, referenciaExterna: string) {
    return [...this.pagos.values()].filter((p) => p.referenciaExterna === referenciaExterna).reverse();
  }

  async reembolsar(_token: string, pagoId: string, idempotencia: string) {
    if (this.fallarProximoReembolso) {
      this.fallarProximoReembolso = false;
      throw new Error('MP no disponible (simulado)');
    }
    const previo = this.reembolsos.find((r) => r.idempotencia === idempotencia);
    if (previo) return { id: previo.id };
    const pago = this.pagos.get(pagoId);
    if (!pago) throw new Error(`pago ${pagoId} inexistente`);
    pago.estado = 'refunded';
    const r = { pagoId, idempotencia, id: `ref-${randomUUID()}` };
    this.reembolsos.push(r);
    return { id: r.id };
  }
}
