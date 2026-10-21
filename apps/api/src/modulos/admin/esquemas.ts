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
