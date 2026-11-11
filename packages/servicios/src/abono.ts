import { instanteLocal, partesLocales, sumarDias } from '@cancheria/core';
import { clubs, miembrosClub, usuarios } from '@cancheria/db/schema';
import { and, eq } from 'drizzle-orm';
import type { Entorno } from './entorno.ts';
import { ErrorNegocio } from './errores.ts';
import type { PasarelaSuscripciones } from './mercadopago/suscripciones.ts';
import type { ServicioPlataforma } from './plataforma.ts';

const ZONA = 'America/Argentina/Buenos_Aires';

/**
 * Cobro automático del abono: una suscripción de Mercado Pago en la cuenta de la
 * plataforma (MP_ABONO_ACCESS_TOKEN). Cada cobro aprobado extiende el abono un mes; si
 * el club estaba suspendido por falta de pago, vuelve a tomar reservas solo.
 */
export class ServicioAbono {
  constructor(
    private readonly e: Entorno & {
      plataforma: ServicioPlataforma;
      pasarela: PasarelaSuscripciones;
      /** Access token de la cuenta de MP de la plataforma; null = cobro automático apagado. */
      token: string | null;
      /** centavos por mes; null = sin abono configurado. */
      abonoMensual: number | null;
    },
  ) {}

  private get disponible() {
    return Boolean(this.e.token && this.e.abonoMensual);
  }

  async estado(clubId: string) {
    const [c] = await this.e.db
      .select({
        abonoHasta: clubs.abonoHasta,
        estado: clubs.mpSuscripcionEstado,
        email: clubs.mpSuscripcionEmail,
        suspendidoPorAbono: clubs.suspendidoPorAbono,
      })
      .from(clubs)
      .where(eq(clubs.id, clubId));
    if (!c) throw new ErrorNegocio(404, 'CLUB_NO_ENCONTRADO', 'No existe ese club');
    return {
      abonoHasta: c.abonoHasta,
      abonoMensual: this.e.abonoMensual,
      /** La plataforma tiene el cobro automático configurado. */
      cobroAutomatico: this.disponible,
      suscripcion: c.estado ? { estado: c.estado, email: c.email } : null,
      suspendidoPorAbono: c.suspendidoPorAbono,
      /** Email del dueño, para proponerlo en el formulario. */
      emailDueno: await this.emailDueno(clubId),
    };
  }

  /** Crea la suscripción y devuelve el link de Mercado Pago donde el dueño la autoriza. */
  async iniciar(clubId: string, email: string) {
    if (!this.disponible || !this.e.token || !this.e.abonoMensual) {
      throw new ErrorNegocio(
        409,
        'COBRO_AUTOMATICO_APAGADO',
        'El pago automático todavía no está disponible',
      );
    }
    const [c] = await this.e.db
      .select({
        nombre: clubs.nombre,
        abonoHasta: clubs.abonoHasta,
        id: clubs.mpSuscripcionId,
        estado: clubs.mpSuscripcionEstado,
      })
      .from(clubs)
      .where(eq(clubs.id, clubId));
    if (!c) throw new ErrorNegocio(404, 'CLUB_NO_ENCONTRADO', 'No existe ese club');
    if (c.estado === 'authorized') {
      throw new ErrorNegocio(409, 'YA_SUSCRIPTO', 'El abono ya se paga automáticamente');
    }
    // Una suscripción anterior sin autorizar se cancela: queda solo la nueva.
    if (c.id && c.estado === 'pending') await this.e.pasarela.cancelar(this.e.token, c.id).catch(() => {});

    // Si tiene días pagos (o de prueba), el primer débito es el día siguiente a esos días.
    const ahora = this.e.reloj();
    const hoy = partesLocales(ahora, ZONA).fecha;
    const inicio =
      c.abonoHasta && c.abonoHasta >= hoy
        ? instanteLocal(sumarDias(c.abonoHasta, 1), '10:00', ZONA)
        : new Date(ahora.getTime() + 10 * 60_000);
    const s = await this.e.pasarela.crear(this.e.token, {
      motivo: `Canchería: abono mensual de ${c.nombre}`,
      referenciaExterna: clubId,
      email: email.trim().toLowerCase(),
      monto: this.e.abonoMensual,
      moneda: 'ARS',
      inicio,
      urlRetorno: `${this.e.urlWeb.replace(/\/$/, '')}/panel/${clubId}/cuenta?abono=listo`,
    });
    await this.e.db
      .update(clubs)
      .set({
        mpSuscripcionId: s.id,
        mpSuscripcionEstado: 'pending',
        mpSuscripcionEmail: email.trim().toLowerCase(),
      })
      .where(eq(clubs.id, clubId));
    return { urlCheckout: s.urlCheckout };
  }

  async cancelar(clubId: string) {
    const [c] = await this.e.db.select({ id: clubs.mpSuscripcionId }).from(clubs).where(eq(clubs.id, clubId));
    if (!c?.id) throw new ErrorNegocio(404, 'SIN_SUSCRIPCION', 'El abono no se paga automáticamente');
    if (this.e.token) await this.e.pasarela.cancelar(this.e.token, c.id);
    await this.e.db.update(clubs).set({ mpSuscripcionEstado: 'cancelled' }).where(eq(clubs.id, clubId));
  }

  /**
   * Aviso de Mercado Pago (webhook). El cuerpo solo dice qué consultar: el estado real se
   * le pide a MP. `subscription_preapproval`: cambió la suscripción (autorizada, pausada,
   * cancelada). `subscription_authorized_payment`: hubo un cobro mensual.
   */
  async procesarNotificacion(tipo: string, id: string) {
    if (!this.e.token) return { tipo: 'IGNORADO' as const };
    if (tipo === 'subscription_preapproval') {
      const s = await this.e.pasarela.obtener(this.e.token, id);
      if (!s) return { tipo: 'NO_ENCONTRADO' as const };
      const filas = await this.e.db
        .update(clubs)
        .set({ mpSuscripcionEstado: s.estado, ...(s.email ? { mpSuscripcionEmail: s.email } : {}) })
        .where(eq(clubs.mpSuscripcionId, s.id))
        .returning({ id: clubs.id });
      return { tipo: filas.length ? ('SUSCRIPCION' as const) : ('NO_ENCONTRADO' as const), estado: s.estado };
    }
    if (tipo === 'subscription_authorized_payment') {
      const cobro = await this.e.pasarela.obtenerCobro(this.e.token, id);
      if (!cobro) return { tipo: 'NO_ENCONTRADO' as const };
      if (cobro.pagoEstado !== 'approved' || !cobro.pagoId) {
        return { tipo: 'COBRO_NO_APROBADO' as const, estado: cobro.pagoEstado };
      }
      const [club] = await this.e.db
        .select({ id: clubs.id })
        .from(clubs)
        .where(eq(clubs.mpSuscripcionId, cobro.suscripcionId));
      if (!club) return { tipo: 'NO_ENCONTRADO' as const };
      const pago = await this.e.plataforma.registrarPago(club.id, null, {
        meses: 1,
        monto: cobro.monto,
        medio: 'MERCADO_PAGO',
        nota: 'Cobro automático de la suscripción',
        mpPagoId: cobro.pagoId,
      });
      return { tipo: pago ? ('ABONO_PAGADO' as const) : ('YA_REGISTRADO' as const) };
    }
    return { tipo: 'IGNORADO' as const };
  }

  private async emailDueno(clubId: string) {
    const [u] = await this.e.db
      .select({ email: usuarios.email })
      .from(miembrosClub)
      .innerJoin(usuarios, eq(usuarios.id, miembrosClub.usuarioId))
      .where(and(eq(miembrosClub.clubId, clubId), eq(miembrosClub.rol, 'OWNER')))
      .limit(1);
    return u?.email ?? null;
  }
}
