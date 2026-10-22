import { z } from 'zod';
import { cuerpoReserva } from '../publico/esquemas.ts';

export const cuerpoLogin = z.object({
  email: z.email().max(120),
  contrasena: z.string().min(1).max(200),
});

const centavos = z.number().int().min(0).max(100_000_000);

export const queryAgenda = z.object({
  fecha: z.iso.date(),
  incluirCancelados: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const cuerpoTurnoManual = z.object({
  canchaId: z.uuid(),
  inicio: z.iso.datetime({ offset: true }),
  fin: z.iso.datetime({ offset: true }).optional(),
  cliente: cuerpoReserva.shape.cliente,
  precio: centavos.optional(),
  nota: z.string().trim().max(500).optional(),
  notificar: z.boolean().optional(),
  idempotencyKey: z.uuid().optional(),
});

export const cuerpoBloqueo = z.object({
  canchaId: z.uuid(),
  inicio: z.iso.datetime({ offset: true }),
  fin: z.iso.datetime({ offset: true }),
  motivo: z.string().trim().min(2).max(500),
});

export const paramsTurno = z.object({ clubId: z.uuid(), turnoId: z.uuid() });
export const paramsPago = z.object({ clubId: z.uuid(), pagoId: z.uuid() });
export const paramsReembolso = z.object({ clubId: z.uuid(), reembolsoId: z.uuid() });

export const cuerpoCancelar = z.object({
  motivo: z.string().trim().min(2).max(300),
  devolverSena: z.boolean(),
  notificar: z.boolean().optional(),
});

export const cuerpoPago = z.object({
  monto: centavos.positive(),
  medio: z.enum(['EFECTIVO', 'TRANSFERENCIA', 'OTRO']),
  concepto: z.enum(['SENA', 'SALDO']),
});

export const cuerpoCheckin = z.object({
  /** Contenido del QR tal cual lo lee la cámara (URL del comprobante o el código). */
  qr: z.string().trim().min(1).max(500),
  forzar: z.boolean().optional(),
});

export const cuerpoRechazo = z.object({ motivo: z.string().trim().min(2).max(300) });

export const queryTransferencias = z.object({
  estado: z.enum(['EN_REVISION', 'APROBADO', 'RECHAZADO']).default('EN_REVISION'),
});

export const queryReembolsos = z.object({
  estado: z.enum(['PENDIENTE', 'HECHO', 'FALLIDO']).optional(),
});

export const cuerpoMercadoPago = z.object({
  accessToken: z.string().trim().min(10).max(300),
  webhookSecret: z.string().trim().min(10).max(300).optional(),
});

export const cuerpoTransferencia = z
  .object({
    alias: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9.-]{6,20}$/, 'alias inválido')
      .optional(),
    cbu: z
      .string()
      .trim()
      .regex(/^\d{22}$/, 'el CBU/CVU tiene 22 dígitos')
      .optional(),
    titular: z.string().trim().min(2).max(120),
  })
  .refine((d) => d.alias || d.cbu, 'Indicá alias o CBU/CVU');

// --- Configuración del club ----------------------------------------------------

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'hora inválida (HH:MM)');
const dia = z.number().int().min(0).max(6);
const texto = (max: number) => z.string().trim().min(1).max(max);
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));

export const cuerpoClub = z.object({
  nombre: texto(120).optional(),
  telefono: textoOpcional(40).optional(),
  direccion: textoOpcional(200).optional(),
  minutosRevisionTransferencia: z.number().int().min(5).max(1440).optional(),
});

export const cuerpoCancha = z.object({
  nombre: texto(60),
  jugadoresPorLado: z.number().int().min(3).max(11),
  superficie: z.enum(['SINTETICO', 'CESPED_NATURAL', 'CEMENTO', 'PARQUET', 'OTRO']),
  techada: z.boolean(),
  iluminacion: z.boolean(),
  duracionTurnoMin: z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(120)]),
  orden: z.number().int().min(0).max(1000),
  activa: z.boolean(),
});

export const cuerpoTarifa = z.object({
  canchaId: z.uuid().nullable(),
  diaSemana: dia.nullable(),
  horaDesde: hora,
  horaHasta: hora,
  precio: centavos,
  etiqueta: textoOpcional(40),
  vigenteDesde: z.iso.date(),
  vigenteHasta: z.iso.date().nullable(),
});

export const cuerpoHorarios = z.array(z.object({ diaSemana: dia, abre: hora, cierra: hora })).max(21);

export const cuerpoDiaEspecial = z.object({
  cerrado: z.boolean(),
  abre: hora.nullable(),
  cierra: hora.nullable(),
  motivo: textoOpcional(120),
});

export const cuerpoRegla = z.object({
  nombre: texto(60),
  canchaId: z.uuid().nullable(),
  diaSemana: dia.nullable(),
  horaDesde: hora.nullable(),
  horaHasta: hora.nullable(),
  requiereSena: z.boolean(),
  tipoSena: z.enum(['PORCENTAJE', 'MONTO_FIJO']),
  /** Porcentaje (0–100) o centavos, según el tipo. */
  valorSena: centavos,
  minutosExpiracion: z.number().int().min(3).max(2880),
  margenMinAntesInicio: z.number().int().min(0).max(1440),
  prioridad: z.number().int().min(0).max(1000),
  activa: z.boolean(),
});

const rol = z.enum(['RECEPCION', 'ADMIN', 'OWNER']);
export const cuerpoInvitar = z.object({ email: z.email().max(120), nombre: texto(80), rol });
export const cuerpoRol = z.object({ rol });

export const cuerpoContrasena = z.object({
  actual: z.string().min(1).max(200),
  nueva: z.string().min(10, 'La contraseña nueva tiene que tener al menos 10 caracteres').max(200),
});

export const paramsCancha = z.object({ clubId: z.uuid(), canchaId: z.uuid() });
export const paramsTarifa = z.object({ clubId: z.uuid(), tarifaId: z.uuid() });
export const paramsRegla = z.object({ clubId: z.uuid(), reglaId: z.uuid() });
export const paramsUsuario = z.object({ clubId: z.uuid(), usuarioId: z.uuid() });
export const paramsFecha = z.object({ clubId: z.uuid(), fecha: z.iso.date() });

// --- Turnos fijos ----------------------------------------------------------------

export const cuerpoTurnoFijo = z.object({
  canchaId: z.uuid(),
  cliente: cuerpoReserva.shape.cliente,
  diaSemana: dia,
  horaInicio: hora,
  duracionMin: z.number().int().min(15).max(360).optional(),
  frecuenciaSemanas: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  vigenteDesde: z.iso.date(),
  vigenteHasta: z.iso.date().nullable().optional(),
  precioPactado: centavos.nullable().optional(),
  nota: textoOpcional(500).optional(),
  notificar: z.boolean().optional(),
});

export const cuerpoPreviaFijo = cuerpoTurnoFijo.omit({ cliente: true, nota: true, notificar: true });

export const cuerpoModificarFijo = z.object({
  precioPactado: centavos.nullable().optional(),
  nota: textoOpcional(500).optional(),
});

export const cuerpoBajaFijo = z.object({
  desde: z.iso.date(),
  motivo: z.string().trim().max(300).optional(),
});

export const paramsFijo = z.object({ clubId: z.uuid(), fijoId: z.uuid() });
export const paramsOmitido = z.object({ clubId: z.uuid(), fijoId: z.uuid(), fecha: z.iso.date() });

// --- Cantina ---------------------------------------------------------------------

const cantidad = z.number().int().min(1).max(10_000);

export const cuerpoProducto = z.object({
  nombre: texto(60),
  categoria: z.enum(['BEBIDA', 'COMIDA', 'ALQUILER', 'OTRO']),
  precio: centavos,
  controlaStock: z.boolean(),
  stockMinimo: z.number().int().min(0).max(100_000),
  activo: z.boolean(),
});
export const cuerpoProductoNuevo = cuerpoProducto.extend({
  stockInicial: z.number().int().min(0).max(100_000),
});

export const cuerpoReposicion = z.object({ cantidad, motivo: z.string().trim().max(200).optional() });
export const cuerpoAjuste = z.object({
  stock: z.number().int().min(0).max(100_000),
  motivo: z.string().trim().min(2).max(200),
});

export const cuerpoVenta = z.object({
  items: z
    .array(z.object({ productoId: z.uuid(), cantidad }))
    .min(1)
    .max(50),
  turnoId: z.uuid().optional(),
  medio: z.enum(['EFECTIVO', 'TRANSFERENCIA', 'MERCADO_PAGO', 'OTRO']).optional(),
  idempotencyKey: z.uuid().optional(),
});

export const queryVentas = z.object({ fecha: z.iso.date().optional(), turnoId: z.uuid().optional() });
export const queryResumenCantina = z.object({ fecha: z.iso.date().optional() });
export const queryProductos = z.object({
  inactivos: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const paramsProducto = z.object({ clubId: z.uuid(), productoId: z.uuid() });
export const paramsVenta = z.object({ clubId: z.uuid(), ventaId: z.uuid() });

// --- Fidelización --------------------------------------------------------------------

export const queryClientes = z.object({ q: z.string().trim().min(2).max(60) });
export const paramsCliente = z.object({ clubId: z.uuid(), clienteId: z.uuid() });
export const paramsCanje = z.object({ clubId: z.uuid(), canjeId: z.uuid() });
export const paramsPremio = z.object({ clubId: z.uuid(), premioId: z.uuid() });
export const paramsPromocion = z.object({ clubId: z.uuid(), promocionId: z.uuid() });

export const cuerpoAjustePuntos = z.object({
  puntos: z.number().int().min(-100_000).max(100_000),
  motivo: z.string().trim().min(2).max(200),
});
export const cuerpoCanje = z.object({
  clienteId: z.uuid(),
  premioId: z.uuid(),
  turnoId: z.uuid().optional(),
});
export const cuerpoAplicarCanje = z.object({ turnoId: z.uuid() });
export const cuerpoPuntosPorPartido = z.object({ puntos: z.number().int().min(0).max(10_000) });

export const cuerpoPremio = z.object({
  nombre: texto(80),
  descripcion: textoOpcional(300),
  costoPuntos: z.number().int().min(1).max(1_000_000),
  tipo: z.enum(['DESCUENTO_MONTO', 'DESCUENTO_PORCENTAJE', 'TURNO_GRATIS', 'PRODUCTO']),
  valor: z.number().int().min(0).max(100_000_000),
  stock: z.number().int().min(0).max(100_000).nullable(),
  activo: z.boolean(),
});

export const cuerpoPromocion = z.object({
  nombre: texto(60),
  diaSemana: dia.nullable(),
  horaDesde: hora.nullable(),
  horaHasta: hora.nullable(),
  multiplicador: z.number().min(0.1).max(10),
  puntosExtra: z.number().int().min(0).max(10_000),
  vigenteDesde: z.iso.date(),
  vigenteHasta: z.iso.date().nullable(),
  activa: z.boolean(),
});
