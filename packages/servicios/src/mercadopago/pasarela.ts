/** Estado de un pago en Mercado Pago (campo `status`). */
export type EstadoPagoMp =
  | 'approved'
  | 'pending'
  | 'in_process'
  | 'authorized'
  | 'rejected'
  | 'cancelled'
  | 'refunded'
  | 'charged_back'
  | (string & {});

export interface PagoMp {
  id: string;
  estado: EstadoPagoMp;
  /** centavos */
  monto: number;
  moneda: string;
  /** Lo que mandamos en la preferencia: el id del turno. */
  referenciaExterna: string | null;
  aprobadoEn: Date | null;
  bruto: unknown;
}

export interface DatosPreferencia {
  titulo: string;
  /** centavos */
  monto: number;
  moneda: string;
  referenciaExterna: string;
  /** El checkout deja de aceptar pagos en este instante (= expira_en del hold). */
  vence: Date;
  urlNotificacion: string;
  urlRetorno: string;
  /** Mismo valor ⇒ MP no crea dos preferencias (reintentos de red). */
  idempotencia: string;
}

export interface PasarelaMp {
  crearPreferencia(token: string, datos: DatosPreferencia): Promise<{ id: string; urlCheckout: string }>;
  obtenerPago(token: string, pagoId: string): Promise<PagoMp | null>;
  /** Pagos asociados a una referencia externa (conciliación cuando no llega el webhook). */
  buscarPagos(token: string, referenciaExterna: string): Promise<PagoMp[]>;
  /** Reembolso total. `idempotencia` evita devolver dos veces si se reintenta. */
  reembolsar(token: string, pagoId: string, idempotencia: string): Promise<{ id: string }>;
}

/** Formato que pide MP para fechas: yyyy-MM-dd'T'HH:mm:ss.SSS±hh:mm. */
const fechaMp = (d: Date) => d.toISOString().replace('Z', '+00:00');

export class ErrorMp extends Error {
  constructor(
    readonly status: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

interface PagoCrudo {
  id: number | string;
  status: string;
  transaction_amount: number;
  currency_id: string;
  external_reference?: string | null;
  date_approved?: string | null;
}

const aPago = (p: PagoCrudo): PagoMp => ({
  id: String(p.id),
  estado: p.status,
  monto: Math.round(p.transaction_amount * 100),
  moneda: p.currency_id,
  referenciaExterna: p.external_reference || null,
  aprobadoEn: p.date_approved ? new Date(p.date_approved) : null,
  bruto: p,
});

/** Cliente REST de Mercado Pago (Checkout Pro). */
export class PasarelaMpHttp implements PasarelaMp {
  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly base = 'https://api.mercadopago.com',
  ) {}

  private async pedir<T>(
    token: string,
    metodo: string,
    ruta: string,
    cuerpo?: unknown,
    idempotencia?: string,
  ) {
    const res = await this.fetchFn(`${this.base}${ruta}`, {
      method: metodo,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(idempotencia ? { 'x-idempotency-key': idempotencia } : {}),
      },
      ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return null;
    if (!res.ok)
      throw new ErrorMp(res.status, `Mercado Pago ${metodo} ${ruta} → ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  async crearPreferencia(token: string, d: DatosPreferencia) {
    const r = await this.pedir<{ id: string; init_point: string }>(
      token,
      'POST',
      '/checkout/preferences',
      {
        items: [{ title: d.titulo, quantity: 1, unit_price: d.monto / 100, currency_id: d.moneda }],
        external_reference: d.referenciaExterna,
        notification_url: d.urlNotificacion,
        back_urls: { success: d.urlRetorno, pending: d.urlRetorno, failure: d.urlRetorno },
        auto_return: 'approved',
        // binary_mode: el pago se aprueba o se rechaza en el momento, sin estados
        // "pendiente" que se resuelven horas después (con el turno ya liberado).
        binary_mode: true,
        // Sin efectivo (Rapipago/Pago Fácil) ni cajeros: se acreditan tarde.
        payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }] },
        expires: true,
        expiration_date_from: fechaMp(new Date()),
        expiration_date_to: fechaMp(d.vence),
      },
      d.idempotencia,
    );
    if (!r) throw new ErrorMp(404, 'Mercado Pago no devolvió la preferencia');
    return { id: r.id, urlCheckout: r.init_point };
  }

  async obtenerPago(token: string, pagoId: string) {
    const p = await this.pedir<PagoCrudo>(token, 'GET', `/v1/payments/${encodeURIComponent(pagoId)}`);
    return p ? aPago(p) : null;
  }

  async buscarPagos(token: string, referenciaExterna: string) {
    const q = new URLSearchParams({
      external_reference: referenciaExterna,
      sort: 'date_created',
      criteria: 'desc',
    });
    const r = await this.pedir<{ results: PagoCrudo[] }>(token, 'GET', `/v1/payments/search?${q}`);
    return (r?.results ?? []).map(aPago);
  }

  async reembolsar(token: string, pagoId: string, idempotencia: string) {
    const r = await this.pedir<{ id: number | string }>(
      token,
      'POST',
      `/v1/payments/${encodeURIComponent(pagoId)}/refunds`,
      {},
      idempotencia,
    );
    if (!r) throw new ErrorMp(404, `pago ${pagoId} inexistente`);
    return { id: String(r.id) };
  }
}
