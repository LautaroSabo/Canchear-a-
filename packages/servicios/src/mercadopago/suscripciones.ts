import { ErrorMp } from './pasarela.ts';

/** Suscripción (preapproval) de Mercado Pago: débito mensual automático. */
export interface SuscripcionMp {
  id: string;
  /** pending (falta que el cliente la autorice) | authorized | paused | cancelled */
  estado: string;
  /** Lo que mandamos al crearla: el id del club. */
  referenciaExterna: string | null;
  email: string | null;
}

/** Un cobro mensual de una suscripción (authorized_payment). */
export interface CobroSuscripcionMp {
  id: string;
  suscripcionId: string;
  /** El pago real detrás del cobro: approved, rejected… (null si todavía no se intentó). */
  pagoId: string | null;
  pagoEstado: string | null;
  /** centavos */
  monto: number;
}

export interface DatosSuscripcion {
  motivo: string;
  referenciaExterna: string;
  email: string;
  /** centavos por mes */
  monto: number;
  moneda: string;
  /** Primer débito (si el club tiene días ya pagos, después de esos días). */
  inicio: Date;
  urlRetorno: string;
}

export interface PasarelaSuscripciones {
  crear(token: string, d: DatosSuscripcion): Promise<{ id: string; urlCheckout: string }>;
  obtener(token: string, id: string): Promise<SuscripcionMp | null>;
  cancelar(token: string, id: string): Promise<void>;
  obtenerCobro(token: string, id: string): Promise<CobroSuscripcionMp | null>;
}

interface PreapprovalCrudo {
  id: string;
  status: string;
  external_reference?: string | null;
  payer_email?: string | null;
  init_point?: string;
}

interface CobroCrudo {
  id: number | string;
  preapproval_id: string;
  transaction_amount?: number;
  payment?: { id?: number | string | null; status?: string | null } | null;
}

/** API de suscripciones de Mercado Pago (/preapproval y /authorized_payments). */
export class PasarelaSuscripcionesHttp implements PasarelaSuscripciones {
  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly base = 'https://api.mercadopago.com',
  ) {}

  private async pedir<T>(token: string, metodo: string, ruta: string, cuerpo?: unknown) {
    const res = await this.fetchFn(`${this.base}${ruta}`, {
      method: metodo,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return null;
    if (!res.ok)
      throw new ErrorMp(res.status, `Mercado Pago ${metodo} ${ruta} → ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  async crear(token: string, d: DatosSuscripcion) {
    const r = await this.pedir<PreapprovalCrudo>(token, 'POST', '/preapproval', {
      reason: d.motivo,
      external_reference: d.referenciaExterna,
      payer_email: d.email,
      back_url: d.urlRetorno,
      status: 'pending',
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        start_date: d.inicio.toISOString(),
        transaction_amount: d.monto / 100,
        currency_id: d.moneda,
      },
    });
    if (!r?.init_point) throw new ErrorMp(502, 'Mercado Pago no devolvió el link de la suscripción');
    return { id: r.id, urlCheckout: r.init_point };
  }

  async obtener(token: string, id: string) {
    const r = await this.pedir<PreapprovalCrudo>(token, 'GET', `/preapproval/${encodeURIComponent(id)}`);
    return r
      ? {
          id: r.id,
          estado: r.status,
          referenciaExterna: r.external_reference ?? null,
          email: r.payer_email ?? null,
        }
      : null;
  }

  async cancelar(token: string, id: string) {
    await this.pedir(token, 'PUT', `/preapproval/${encodeURIComponent(id)}`, { status: 'cancelled' });
  }

  async obtenerCobro(token: string, id: string) {
    const r = await this.pedir<CobroCrudo>(token, 'GET', `/authorized_payments/${encodeURIComponent(id)}`);
    if (!r) return null;
    return {
      id: String(r.id),
      suscripcionId: r.preapproval_id,
      pagoId: r.payment?.id != null ? String(r.payment.id) : null,
      pagoEstado: r.payment?.status ?? null,
      monto: Math.round((r.transaction_amount ?? 0) * 100),
    };
  }
}

/** Para tests y desarrollo: guarda todo en memoria. */
export class PasarelaSuscripcionesFalsa implements PasarelaSuscripciones {
  readonly suscripciones = new Map<string, SuscripcionMp & { datos: DatosSuscripcion }>();
  readonly cobros = new Map<string, CobroSuscripcionMp>();
  private n = 0;

  async crear(_token: string, d: DatosSuscripcion) {
    const id = `pre_${++this.n}`;
    this.suscripciones.set(id, {
      id,
      estado: 'pending',
      referenciaExterna: d.referenciaExterna,
      email: d.email,
      datos: d,
    });
    return { id, urlCheckout: `https://mp.test/suscripcion/${id}` };
  }
  async obtener(_token: string, id: string) {
    const s = this.suscripciones.get(id);
    return s ? { id: s.id, estado: s.estado, referenciaExterna: s.referenciaExterna, email: s.email } : null;
  }
  async cancelar(_token: string, id: string) {
    const s = this.suscripciones.get(id);
    if (s) s.estado = 'cancelled';
  }
  async obtenerCobro(_token: string, id: string) {
    return this.cobros.get(id) ?? null;
  }
  /** Simula que el cliente autorizó la suscripción en Mercado Pago. */
  autorizar(id: string) {
    const s = this.suscripciones.get(id);
    if (s) s.estado = 'authorized';
  }
  /** Simula un cobro mensual. */
  cobrar(suscripcionId: string, estado = 'approved') {
    const id = `cobro_${++this.n}`;
    const s = this.suscripciones.get(suscripcionId);
    this.cobros.set(id, {
      id,
      suscripcionId,
      pagoId: `pago_${this.n}`,
      pagoEstado: estado,
      monto: s?.datos.monto ?? 0,
    });
    return id;
  }
}
