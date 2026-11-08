import { boolean, date, pgTable, smallint, text, time, timestamp, uuid } from 'drizzle-orm/pg-core';
import { citext } from './tipos.ts';

const ts = () => timestamp({ withTimezone: true, mode: 'date' });

export type EstadoTorneo = 'INSCRIPCION' | 'EN_CURSO' | 'FINALIZADO';

/** Torneo o liga: grupos todos contra todos y, si clasifican, cuadro de eliminación. */
export const torneos = pgTable('torneos', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  nombre: text().notNull(),
  slug: citext().notNull(),
  descripcion: text(),
  jugadoresPorLado: smallint().notNull().default(5),
  estado: text().$type<EstadoTorneo>().notNull().default('INSCRIPCION'),
  inscripcionOnline: boolean().notNull().default(false),
  cantidadGrupos: smallint().notNull().default(1),
  idaYVuelta: boolean().notNull().default(false),
  clasificanPorGrupo: smallint().notNull().default(0),
  puntosVictoria: smallint().notNull().default(3),
  puntosEmpate: smallint().notNull().default(1),
  dias: smallint().array().notNull().default([]),
  horaDesde: time(),
  horaHasta: time(),
  canchaIds: uuid().array().notNull().default([]),
  fechaInicio: date({ mode: 'string' }),
  duracionMin: smallint().notNull().default(60),
  creadoEn: ts().notNull().defaultNow(),
});

export const torneoEquipos = pgTable('torneo_equipos', {
  id: uuid().primaryKey().defaultRandom(),
  torneoId: uuid().notNull(),
  nombre: citext().notNull(),
  delegadoNombre: text().notNull(),
  delegadoTelefono: text().notNull(),
  estado: text().$type<'PENDIENTE' | 'APROBADO' | 'RECHAZADO'>().notNull().default('APROBADO'),
  grupo: smallint(),
  creadoEn: ts().notNull().defaultNow(),
});

export const torneoPartidos = pgTable('torneo_partidos', {
  id: uuid().primaryKey().defaultRandom(),
  torneoId: uuid().notNull(),
  fase: text().$type<'GRUPOS' | 'ELIMINACION'>().notNull(),
  grupo: smallint(),
  fecha: smallint(),
  ronda: smallint(),
  orden: smallint(),
  localId: uuid(),
  visitanteId: uuid(),
  canchaId: uuid(),
  inicio: ts(),
  fin: ts(),
  turnoId: uuid(),
  golesLocal: smallint(),
  golesVisitante: smallint(),
  penalesLocal: smallint(),
  penalesVisitante: smallint(),
  ganadorId: uuid(),
  estado: text().$type<'PROGRAMADO' | 'JUGADO'>().notNull().default('PROGRAMADO'),
  creadoEn: ts().notNull().defaultNow(),
});
