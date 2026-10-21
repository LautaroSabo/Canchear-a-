// Formas de las respuestas de la API (ver docs/api-publica.md y docs/api-admin.md).
// Importes en centavos; instantes en ISO UTC.

export interface CanchaPublica {
  id: string;
  nombre: string;
  jugadoresPorLado: number;
  superficie: string;
  techada: boolean;
  iluminacion: boolean;
  caracteristicas: Record<string, unknown>;
  duracionMin: number;
}

export interface ClubPublico {
  slug: string;
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  logoUrl: string | null;
  zonaHoraria: string;
  mediosPago: {
    mercadoPago: boolean;
    transferencia: { alias?: string; cbu?: string; titular?: string } | null;
  };
  canchas: CanchaPublica[];
}

export type EstadoSlot = 'LIBRE' | 'OCUPADO' | 'PASADO';

export interface Slot {
  inicio: string;
  fin: string;
  estado: EstadoSlot;
  precio: number;
  montoSena: number;
  requiereSena: boolean;
}

export interface Disponibilidad {
  fecha: string;
  canchas: (Omit<CanchaPublica, 'iluminacion' | 'caracteristicas'> & { slots: Slot[] })[];
}

export type EstadoTurno = 'PRE_RESERVADO' | 'CONFIRMADO' | 'PRESENTE' | 'AUSENTE' | 'CANCELADO' | 'EXPIRADO';

export interface ReservaPublica {
  codigo: string;
  estado: EstadoTurno;
  club: { slug: string; nombre: string };
  cancha: { id: string; nombre: string };
  inicio: string;
  fin: string;
  precioTotal: number;
  montoSena: number;
  saldoAPagar: number;
  expiraEn: string | null;
  senaEnRevision: boolean;
  cliente: { nombre: string };
}

export interface Alternativa {
  canchaId: string;
  cancha: string;
  inicio: string;
  fin: string;
  precio: number;
}

// --- Panel ---------------------------------------------------------------------

export type Rol = 'OWNER' | 'ADMIN' | 'RECEPCION';

export interface Sesion {
  usuario: { id: string; email: string; nombre: string };
  clubs: { id: string; slug: string; nombre: string; zonaHoraria: string; rol: Rol }[];
}

export interface TurnoAgenda {
  id: string;
  canchaId: string;
  inicio: string;
  fin: string;
  estado: EstadoTurno;
  origen: 'WEB' | 'MANUAL' | 'FIJO' | 'BLOQUEO';
  precioTotal: number;
  montoSena: number;
  expiraEn: string | null;
  checkinEn: string | null;
  nota: string | null;
  motivoCancelacion: string | null;
  cliente: { id: string; nombre: string; telefono: string } | null;
  pagado: number;
  saldo: number;
  senaEnRevision: boolean;
}

export interface Agenda {
  fecha: string;
  zonaHoraria: string;
  apertura: { inicio: string; fin: string }[];
  canchas: { id: string; nombre: string; jugadoresPorLado: number; duracionMin: number }[];
  turnos: TurnoAgenda[];
}

export interface DetalleTurno extends Omit<TurnoAgenda, 'cliente' | 'senaEnRevision'> {
  cancha: string;
  codigo: string;
  cliente: { id: string; nombre: string; telefono: string; dni: string | null; bloqueado: boolean } | null;
  pagos: {
    id: string;
    proveedor: string;
    concepto: string;
    estado: string;
    monto: number;
    creadoEn: string;
    tieneComprobante: boolean;
    reembolso: { id: string; estado: string; motivo: string } | null;
  }[];
  historial: { de: EstadoTurno | null; a: EstadoTurno; actor: string; en: string }[];
}

export interface ResumenCobro {
  turnoId: string;
  estado: EstadoTurno;
  inicio: string;
  fin: string;
  cancha: string;
  cliente: { nombre: string; telefono: string } | null;
  precioTotal: number;
  pagado: number;
  saldo: number;
}

export interface Transferencia {
  pagoId: string;
  monto: number;
  estado: string;
  enviadaEn: string;
  turno: { id: string; inicio: string; estado: EstadoTurno; expiraEn: string | null; montoSena: number };
  cancha: string;
  cliente: { nombre: string; telefono: string } | null;
}

export interface Reembolso {
  id: string;
  monto: number;
  motivo: string;
  estado: 'PENDIENTE' | 'HECHO' | 'FALLIDO';
  intentos: number;
  error: string | null;
  creadoEn: string;
  hechoEn: string | null;
  medio: string;
  turnoId: string;
  cliente: { nombre: string; telefono: string } | null;
  manual: boolean;
}
