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
  confirmado: 'bg-cancha-claro text-[#0a3f20] border-[1.5px] border-cancha',
  presente: 'bg-cancha text-white border-[1.5px] border-cancha',
  pendiente: 'bg-ambar-fondo text-ambar-texto border-[1.5px] border-dashed border-ambar-borde',
  revision: 'bg-azul-fondo text-azul-texto border-[1.5px] border-azul-borde',
  bloqueo:
    'text-[#2e363d] border-[1.5px] border-[#9aa3ab] bg-[repeating-linear-gradient(135deg,#e4e7ea_0,#e4e7ea_8px,#eceef0_8px,#eceef0_16px)]',
  ausente: 'bg-[#fdecea] text-[#7a1a0c] border-[1.5px] border-[#f1b5ab]',
  cancelado: 'bg-white text-suave border-[1.5px] border-linea line-through',
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
