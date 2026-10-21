import { z } from 'zod';

export const paramsSlug = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,60}$/i, 'slug inválido'),
});

export const paramsCodigo = z.object({
  codigo: z.string().regex(/^[0-9a-f]{32}$/, 'código inválido'),
});

export const queryDisponibilidad = z.object({
  fecha: z.iso.date(),
  jugadores: z.coerce.number().int().min(3).max(11).optional(),
  canchaId: z.uuid().optional(),
});

const sinSeparadores = (s: string) => s.replace(/[.\s-]/g, '');

export const cuerpoReserva = z.object({
  canchaId: z.uuid(),
  inicio: z.iso.datetime({ offset: true }),
  cliente: z.object({
    nombre: z.string().trim().min(2).max(80),
    telefono: z.string().trim().min(6).max(30),
    /** Acepta "30.123.456". */
    dni: z
      .string()
      .transform(sinSeparadores)
      .pipe(z.string().regex(/^\d{6,9}$/, 'DNI inválido'))
      .optional(),
    email: z.email().max(120).optional(),
  }),
  /** Generada por el front una vez por intento de reserva (doble clic / reintentos). */
  idempotencyKey: z.uuid(),
});

export type CuerpoReserva = z.infer<typeof cuerpoReserva>;

const horaLocal = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'hora inválida (HH:MM)');

export const cuerpoListaEspera = z.object({
  cliente: cuerpoReserva.shape.cliente,
  fecha: z.iso.date(),
  /** Franja local del club en la que le sirve jugar; "hasta" <= "desde" cruza la medianoche. */
  desde: horaLocal,
  hasta: horaLocal,
  jugadores: z.coerce.number().int().min(3).max(11).optional(),
  canchaId: z.uuid().optional(),
});
