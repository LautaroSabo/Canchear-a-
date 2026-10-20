import { pgEnum } from 'drizzle-orm/pg-core';

export const estadoTurno = pgEnum('estado_turno', [
  'PRE_RESERVADO',
  'CONFIRMADO',
  'PRESENTE',
  'AUSENTE',
  'CANCELADO',
  'EXPIRADO',
]);
export const origenTurno = pgEnum('origen_turno', ['WEB', 'MANUAL', 'FIJO', 'BLOQUEO']);
export const tipoSuperficie = pgEnum('tipo_superficie', [
  'SINTETICO',
  'CESPED_NATURAL',
  'CEMENTO',
  'PARQUET',
  'OTRO',
]);
export const rolMiembro = pgEnum('rol_miembro', ['OWNER', 'ADMIN', 'RECEPCION']);
export const proveedorPago = pgEnum('proveedor_pago', ['MERCADO_PAGO', 'TRANSFERENCIA', 'EFECTIVO', 'OTRO']);
export const conceptoPago = pgEnum('concepto_pago', ['SENA', 'SALDO', 'CONSUMO', 'REEMBOLSO']);
export const estadoPago = pgEnum('estado_pago', [
  'PENDIENTE',
  'EN_REVISION',
  'APROBADO',
  'RECHAZADO',
  'REEMBOLSADO',
]);
export const tipoSena = pgEnum('tipo_sena', ['PORCENTAJE', 'MONTO_FIJO']);
export const estadoEspera = pgEnum('estado_espera', [
  'ACTIVA',
  'NOTIFICADA',
  'CONVERTIDA',
  'VENCIDA',
  'CANCELADA',
]);
export const canalNotif = pgEnum('canal_notif', ['WHATSAPP', 'SMS', 'PUSH', 'EMAIL']);
export const estadoNotif = pgEnum('estado_notif', ['PENDIENTE', 'ENVIADA', 'FALLIDA']);
export const tipoMovPuntos = pgEnum('tipo_mov_puntos', ['ACUMULACION', 'CANJE', 'AJUSTE', 'REVERSION']);
export const tipoPremio = pgEnum('tipo_premio', [
  'DESCUENTO_MONTO',
  'DESCUENTO_PORCENTAJE',
  'TURNO_GRATIS',
  'PRODUCTO',
]);
export const estadoCanje = pgEnum('estado_canje', ['EMITIDO', 'USADO', 'ANULADO']);

/** Estados que ocupan la cancha (los mismos del WHERE de la exclusion constraint). */
export const ESTADOS_QUE_OCUPAN = ['PRE_RESERVADO', 'CONFIRMADO', 'PRESENTE', 'AUSENTE'] as const;
