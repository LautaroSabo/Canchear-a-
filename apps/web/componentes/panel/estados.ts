import type { EstadoTurno, TurnoAgenda } from '@/lib/tipos';

export type Apariencia =
  | 'confirmado'
  | 'presente'
  | 'pendiente'
  | 'revision'
  | 'bloqueo'
  | 'ausente'
  | 'cancelado';

/** Cada estado se distingue también por forma (borde punteado, rayado, relleno), no solo por color. */
export const CLASES: Record<Apariencia, string> = {
  confirmado: 'bg-ok-fondo text-ok-texto border border-ok-borde',
  presente: 'bg-acento text-acento-tinta border border-acento',
  pendiente: 'bg-aviso-fondo text-aviso-texto border border-dashed border-aviso-borde',
  revision: 'bg-info-fondo text-info-texto border border-info-borde',
  bloqueo:
    'text-tenue border border-borde-control bg-[repeating-linear-gradient(135deg,var(--superficie-2)_0,var(--superficie-2)_8px,var(--superficie)_8px,var(--superficie)_16px)]',
  ausente: 'bg-error-fondo text-error-texto border border-error-borde',
  cancelado: 'bg-superficie text-tenue border border-linea line-through',
};

export const TEXTOS: Record<Apariencia, string> = {
  confirmado: 'Confirmado',
  presente: 'En cancha',
  pendiente: 'Seña pendiente',
  revision: 'Transferencia a revisar',
  bloqueo: 'Bloqueo',
  ausente: 'Ausente',
  cancelado: 'Cancelado',
};

export function apariencia(t: { estado: EstadoTurno; origen: string; senaEnRevision?: boolean }): Apariencia {
  if (t.origen === 'BLOQUEO') return 'bloqueo';
  switch (t.estado) {
    case 'PRESENTE':
      return 'presente';
    case 'PRE_RESERVADO':
      return t.senaEnRevision ? 'revision' : 'pendiente';
    case 'AUSENTE':
      return 'ausente';
    case 'CANCELADO':
    case 'EXPIRADO':
      return 'cancelado';
    default:
      return 'confirmado';
  }
}

export const ORIGENES: Record<TurnoAgenda['origen'], string> = {
  WEB: 'Reserva web',
  MANUAL: 'Carga manual',
  FIJO: 'Turno fijo',
  BLOQUEO: 'Bloqueo',
};

/** Quién hizo un cambio, según el actor de la auditoría. */
export function actorLegible(actor: string) {
  if (actor === 'cliente') return 'Cliente (web)';
  if (actor === 'webhook:mp') return 'Mercado Pago';
  if (actor === 'worker') return 'Sistema (vencimiento)';
  if (actor === 'worker:lista-espera') return 'Lista de espera';
  if (actor === 'worker:turnos-fijos') return 'Turno fijo';
  if (actor.startsWith('usuario:')) return 'Club';
  return actor;
}

export const ESTADOS_HISTORIAL: Record<EstadoTurno, string> = {
  PRE_RESERVADO: 'Reservado, seña pendiente',
  CONFIRMADO: 'Confirmado',
  PRESENTE: 'Check-in',
  AUSENTE: 'Ausente',
  CANCELADO: 'Cancelado',
  EXPIRADO: 'Venció sin pagar',
};
