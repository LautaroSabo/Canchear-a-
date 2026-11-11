// Formas de las respuestas de la API (ver docs/api-publica.md y docs/api-admin.md).
// Importes en centavos; instantes en ISO UTC.

export interface CanchaPublica {
  id: string;
  nombre: string;
  /** FUTBOL, PADEL o TENIS (las respuestas viejas no lo traen: es fútbol). */
  deporte?: 'FUTBOL' | 'PADEL' | 'TENIS';
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
  /** Pendiente de aprobación o suspendido: se ve la grilla pero no se reserva. */
  habilitado: boolean;
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
  /** Minutos que se guarda el turno para pagar la seña; null sin seña. */
  minutosParaPagar: number | null;
}

export interface Disponibilidad {
  fecha: string;
  canchas: (Omit<CanchaPublica, 'iluminacion' | 'caracteristicas'> & { slots: Slot[] })[];
}

export type EstadoTurno = 'PRE_RESERVADO' | 'CONFIRMADO' | 'PRESENTE' | 'AUSENTE' | 'CANCELADO' | 'EXPIRADO';

export interface ReservaPublica {
  codigo: string;
  codigoInvitacion: string;
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
  /** Después del check-in. */
  puntos: { ganados: number; saldo: number } | null;
  /** Si el jugador puede cancelar online y hasta cuándo (hasta = null: el club no lo permite). */
  cancelacion: { permitida: boolean; hasta: string | null };
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

export type EstadoClub = 'PENDIENTE' | 'ACTIVO' | 'SUSPENDIDO';

export interface Sesion {
  usuario: { id: string; email: string; nombre: string; esSuperadmin: boolean };
  clubs: {
    id: string;
    slug: string;
    nombre: string;
    zonaHoraria: string;
    rol: Rol;
    estado: EstadoClub;
    motivoSuspension: string | null;
    /** Último día cubierto por el abono (YYYY-MM-DD). */
    abonoHasta: string | null;
  }[];
  /** Abono mensual de la plataforma, en centavos (null si no se configuró). */
  abonoMensual: number | null;
  comoPagarAbono: string | null;
  /** Días gratis que se ofrecen al aprobar un club (DIAS_PRUEBA). */
  diasPrueba?: number;
}

export interface ClubPlataforma {
  id: string;
  slug: string;
  nombre: string;
  telefono: string | null;
  direccion: string | null;
  estado: EstadoClub;
  creadoEn: string;
  aprobadoEn: string | null;
  motivoSuspension: string | null;
  abonoHasta: string | null;
  dueno: { nombre: string; email: string } | null;
  canchas: number;
  turnosUltimos30Dias: number;
}

export interface PagoAbono {
  id: string;
  monto: number;
  meses: number;
  desde: string;
  hasta: string;
  medio: string;
  nota: string | null;
  creadoEn: string;
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
  /** Cantina a cuenta del turno. */
  consumos: number;
  /** Canjes de puntos aplicados. */
  descuentos: number;
  pagado: number;
  saldo: number;
  senaEnRevision: boolean;
}

export interface Agenda {
  fecha: string;
  zonaHoraria: string;
  apertura: { inicio: string; fin: string }[];
  canchas: {
    id: string;
    nombre: string;
    deporte?: 'FUTBOL' | 'PADEL' | 'TENIS';
    jugadoresPorLado: number;
    duracionMin: number;
  }[];
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
  ventas: VentaCantina[];
  canjes: { saldoPuntos: number; aplicados: Canje[]; disponibles: Canje[] };
}

export interface ResumenCobro {
  turnoId: string;
  estado: EstadoTurno;
  inicio: string;
  fin: string;
  cancha: string;
  cliente: { nombre: string; telefono: string } | null;
  precioTotal: number;
  /** Cantina a cuenta del turno. */
  consumos: number;
  /** Canjes de puntos aplicados. */
  descuentos: number;
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

// --- Configuración del club (panel) ---------------------------------------------

export type Superficie = 'SINTETICO' | 'CESPED_NATURAL' | 'CEMENTO' | 'PARQUET' | 'POLVO_LADRILLO' | 'OTRO';

export interface CanchaConfig {
  id: string;
  nombre: string;
  deporte: 'FUTBOL' | 'PADEL' | 'TENIS';
  jugadoresPorLado: number;
  superficie: Superficie;
  techada: boolean;
  iluminacion: boolean;
  duracionTurnoMin: 30 | 60 | 90 | 120;
  orden: number;
  activa: boolean;
}

export interface TarifaConfig {
  id: string;
  canchaId: string | null;
  diaSemana: number | null;
  horaDesde: string;
  horaHasta: string;
  /** Centavos por turno. */
  precio: number;
  etiqueta: string | null;
  vigenteDesde: string;
  vigenteHasta: string | null;
}

export interface FranjaHorario {
  diaSemana: number;
  abre: string;
  cierra: string;
}

export interface DiaEspecial {
  fecha: string;
  cerrado: boolean;
  abre: string | null;
  cierra: string | null;
  motivo: string | null;
}

export interface ReglaSena {
  id: string;
  nombre: string;
  canchaId: string | null;
  diaSemana: number | null;
  horaDesde: string | null;
  horaHasta: string | null;
  requiereSena: boolean;
  tipoSena: 'PORCENTAJE' | 'MONTO_FIJO';
  /** Porcentaje o centavos, según el tipo. */
  valorSena: number;
  minutosExpiracion: number;
  margenMinAntesInicio: number;
  prioridad: number;
  activa: boolean;
}

export interface ConfigClub {
  club: {
    id: string;
    slug: string;
    nombre: string;
    telefono: string | null;
    direccion: string | null;
    zonaHoraria: string;
    minutosRevisionTransferencia: number;
    horasCancelacion: number;
    horasRecordatorio: number;
  };
  canchas: CanchaConfig[];
  tarifas: TarifaConfig[];
  horarios: FranjaHorario[];
  diasEspeciales: DiaEspecial[];
  reglas: ReglaSena[];
  avisos: { nivel: 'error' | 'advertencia'; mensaje: string }[];
}

export interface UsuarioClub {
  id: string;
  email: string;
  nombre: string;
  activo: boolean;
  rol: Rol;
}

// --- Turnos fijos ------------------------------------------------------------------

export type MotivoOmision = 'OCUPADO' | 'CERRADO' | 'SIN_TARIFA';

export interface TurnoFijo {
  id: string;
  canchaId: string;
  cancha: string;
  cliente: { id: string; nombre: string; telefono: string };
  diaSemana: number;
  horaInicio: string;
  duracionMin: number;
  frecuenciaSemanas: 1 | 2 | 4;
  vigenteDesde: string;
  vigenteHasta: string | null;
  precioPactado: number | null;
  nota: string | null;
  activo: boolean;
  proximo: string | null;
  omitidos: { fecha: string; motivo: MotivoOmision; conflicto: string | null }[];
}

export interface OcurrenciaFijo {
  fecha: string;
  inicio: string;
  fin: string;
  estado: 'LIBRE' | MotivoOmision;
  precio: number | null;
  conflicto: { turnoId: string; cliente: string | null; origen: string } | null;
}

export interface ResultadoFijo {
  id: string;
  creados: number;
  omitidos: { fecha: string; motivo: MotivoOmision }[];
}

// --- Cantina -----------------------------------------------------------------------

export type CategoriaProducto = 'BEBIDA' | 'COMIDA' | 'ALQUILER' | 'OTRO';
export type MedioCantina = 'EFECTIVO' | 'TRANSFERENCIA' | 'MERCADO_PAGO' | 'OTRO';

export interface Producto {
  id: string;
  nombre: string;
  categoria: CategoriaProducto;
  precio: number;
  controlaStock: boolean;
  stock: number;
  stockMinimo: number;
  activo: boolean;
}

export interface VentaCantina {
  id: string;
  turnoId: string | null;
  medio: MedioCantina | null;
  total: number;
  creadoEn: string;
  anuladaEn: string | null;
  motivoAnulacion: string | null;
  items: { productoId: string; nombre: string; cantidad: number; precioUnitario: number }[];
}

export interface ResumenCantina {
  fecha: string;
  cobradoPorMedio: Partial<Record<MedioCantina, number>>;
  cobrado: number;
  aCuentaDeTurnos: number;
  ventas: number;
  anuladas: number;
  masVendidos: { nombre: string; cantidad: number; total: number }[];
  stockBajo: { id: string; nombre: string; stock: number; stockMinimo: number }[];
}

// --- Fidelización ------------------------------------------------------------------

export type TipoPremio = 'DESCUENTO_MONTO' | 'DESCUENTO_PORCENTAJE' | 'TURNO_GRATIS' | 'PRODUCTO';

export interface Premio {
  id: string;
  nombre: string;
  descripcion: string | null;
  costoPuntos: number;
  tipo: TipoPremio;
  valor: number;
  stock: number | null;
  activo: boolean;
}

export interface PromocionPuntos {
  id: string;
  nombre: string;
  diaSemana: number | null;
  horaDesde: string | null;
  horaHasta: string | null;
  multiplicador: number;
  puntosExtra: number;
  vigenteDesde: string;
  vigenteHasta: string | null;
  activa: boolean;
}

export interface ConfigFidelizacion {
  puntosPorPartido: number;
  premios: Premio[];
  promociones: PromocionPuntos[];
}

export interface Canje {
  id: string;
  codigo: string;
  estado: 'EMITIDO' | 'USADO' | 'ANULADO';
  puntos: number;
  montoAplicado: number;
  turnoId: string | null;
  creadoEn: string;
  usadoEn: string | null;
  premio: { id: string; nombre: string; tipo: TipoPremio; valor: number };
}

export interface ClienteResumen {
  id: string;
  nombre: string;
  telefono: string;
  saldoPuntos: number;
  bloqueado: boolean;
  partidos: number;
}

export interface FichaCliente extends Omit<ClienteResumen, 'partidos'> {
  dni: string | null;
  creadoEn: string;
  partidos: number;
  ausencias: number;
  cancelados: number;
  ultimo: string | null;
  movimientos: {
    id: string;
    tipo: 'ACUMULACION' | 'CANJE' | 'AJUSTE' | 'REVERSION';
    puntos: number;
    motivo: string | null;
    creadoEn: string;
    turnoInicio: string | null;
    promocion: string | null;
    premio: string | null;
  }[];
  canjes: Canje[];
  proximosTurnos: { id: string; inicio: string; estado: EstadoTurno; precioTotal: number }[];
}

// --- Reportes ----------------------------------------------------------------------

export interface BloqueOcupacion {
  disponible: number;
  ocupado: number;
}

export interface ReporteClub {
  desde: string;
  hasta: string;
  zonaHoraria: string;
  ocupacion: BloqueOcupacion & {
    porcentaje: number;
    /** [díaSemana 0=domingo][hora] */
    mapa: BloqueOcupacion[][];
    porCancha: (BloqueOcupacion & {
      canchaId: string;
      nombre: string;
      partidos: number;
      facturado: number;
    })[];
  };
  dinero: {
    cobrado: number;
    cobradoTurnos: number;
    cobradoCantina: number;
    devuelto: number;
    porMedio: Record<string, number>;
    porConcepto: Record<string, number>;
    descuentosPorPuntos: number;
    canjesAplicados: number;
    porCobrar: number;
    turnosConSaldo: number;
  };
  turnos: {
    porEstado: Record<string, number>;
    porOrigen: Record<string, number>;
    jugados: number;
    ausentismo: number;
  };
  clientes: {
    nuevos: number;
    frecuentes: { id: string; nombre: string; telefono: string; partidos: number }[];
    masAusencias: { id: string; nombre: string; telefono: string; ausencias: number }[];
  };
  cantina: {
    mostrador: number;
    aCuentaDeTurnos: number;
    masVendidos: { nombre: string; cantidad: number; total: number }[];
  };
  porDia: (BloqueOcupacion & { fecha: string; cobrado: number })[];
}

export interface MensajeCliente {
  id: string;
  plantilla: string;
  canal: 'WHATSAPP' | 'EMAIL' | 'SMS' | 'PUSH';
  destino: string;
  estado: 'PENDIENTE' | 'ENVIADA' | 'FALLIDA';
  intentos: number;
  error: string | null;
  creadoEn: string;
  enviadaEn: string | null;
  cliente: string | null;
  texto: string;
}

// --- Torneos -----------------------------------------------------------------------

export type EstadoTorneo = 'INSCRIPCION' | 'EN_CURSO' | 'FINALIZADO';

export interface TorneoResumen {
  id: string;
  nombre: string;
  slug: string;
  estado: EstadoTorneo;
  deporte?: 'FUTBOL' | 'PADEL' | 'TENIS';
  jugadoresPorLado: number;
  inscripcionOnline: boolean;
  fechaInicio: string;
  equipos: number;
  /** Solo en el panel. */
  pendientes?: number;
}

export interface ConfigTorneo {
  nombre: string;
  descripcion: string | null;
  deporte?: 'FUTBOL' | 'PADEL' | 'TENIS';
  jugadoresPorLado: number;
  inscripcionOnline: boolean;
  cantidadGrupos: number;
  idaYVuelta: boolean;
  clasificanPorGrupo: number;
  dias: number[];
  horaDesde: string;
  horaHasta: string;
  canchaIds: string[];
  fechaInicio: string;
  duracionMin: number;
}

export interface EquipoTorneo {
  id: string;
  nombre: string;
  estado: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';
  grupo: number | null;
  delegadoNombre?: string;
  delegadoTelefono?: string;
  delegadoEmail?: string | null;
}

export interface FilaTabla {
  equipo: string;
  nombre: string;
  pj: number;
  pg: number;
  pe: number;
  pp: number;
  gf: number;
  gc: number;
  dg: number;
  pts: number;
}

export interface PartidoTorneo {
  id: string;
  fase: 'GRUPOS' | 'ELIMINACION';
  grupo: number | null;
  fecha: number | null;
  ronda: number | null;
  orden: number | null;
  local: { id: string; nombre: string } | null;
  visitante: { id: string; nombre: string } | null;
  canchaId: string | null;
  cancha: string | null;
  inicio: string | null;
  fin: string | null;
  golesLocal: number | null;
  golesVisitante: number | null;
  penalesLocal: number | null;
  penalesVisitante: number | null;
  ganadorId: string | null;
  estado: 'PROGRAMADO' | 'JUGADO';
}

export interface VistaTorneo {
  torneo: ConfigTorneo & { id: string; slug: string; estado: EstadoTorneo };
  equipos: EquipoTorneo[];
  grupos: { numero: number; tabla: FilaTabla[] }[];
  partidos: PartidoTorneo[];
  eliminacionPendiente: boolean;
}

/** El partido como lo ve el grupo (link que se comparte desde el comprobante). */
export interface PartidoCompartido {
  estado: 'CONFIRMADO' | 'PENDIENTE' | 'CANCELADO';
  club: { slug: string; nombre: string; direccion: string | null; zonaHoraria: string };
  cancha: string;
  inicio: string;
  fin: string;
  organizador: string;
}

// --- Caja ---------------------------------------------------------------------------

export type MedioCaja = 'EFECTIVO' | 'TRANSFERENCIA' | 'MERCADO_PAGO' | 'OTRO';

export interface FilaCaja {
  medio: MedioCaja;
  senas: number;
  saldos: number;
  cantina: number;
  devoluciones: number;
  total: number;
}

export interface CajaActual {
  desde: string;
  hasta: string;
  porMedio: FilaCaja[];
  total: number;
  efectivoEsperado: number;
  movimientos: number;
  ultimoCierre: { hasta: string; usuario: string } | null;
}

export interface CierreCaja {
  id: string;
  desde: string;
  hasta: string;
  efectivoEsperado: number;
  efectivoContado: number;
  diferencia: number;
  nota: string | null;
  usuario?: string;
}

// --- Abono de la plataforma ------------------------------------------------------------

export interface EstadoAbono {
  abonoHasta: string | null;
  abonoMensual: number | null;
  cobroAutomatico: boolean;
  suscripcion: {
    estado: 'pending' | 'authorized' | 'paused' | 'cancelled' | string;
    email: string | null;
  } | null;
  suspendidoPorAbono: boolean;
  emailDueno: string | null;
}
