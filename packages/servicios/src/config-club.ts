import type { DiaEspecial, HorarioApertura, ReglaSena, Tarifa } from '@cancheria/core';
import type { Db } from '@cancheria/db';
import {
  canchas,
  clubs,
  configuracionExpiracion,
  diasEspeciales,
  horariosApertura,
  tarifas,
} from '@cancheria/db/schema';
import { and, asc, eq, gte, type SQL, sql } from 'drizzle-orm';

export interface Cancha {
  id: string;
  nombre: string;
  jugadoresPorLado: number;
  superficie: string;
  techada: boolean;
  iluminacion: boolean;
  caracteristicas: Record<string, unknown>;
  duracionTurnoMin: number;
}

/** Todo lo que hace falta para armar la grilla y cotizar un turno de un club. */
export interface ConfigClub {
  club: {
    id: string;
    slug: string;
    nombre: string;
    zonaHoraria: string;
    telefono: string | null;
    direccion: string | null;
    logoUrl: string | null;
    moneda: string;
    minutosRevisionTransferencia: number;
  };
  mediosPago: {
    /** El club cargó sus credenciales de Mercado Pago. */
    mercadoPago: boolean;
    transferencia: { alias?: string; cbu?: string; titular?: string } | null;
  };
  canchas: Cancha[];
  horarios: HorarioApertura[];
  especiales: DiaEspecial[];
  tarifas: Tarifa[];
  reglas: ReglaSena[];
}

/**
 * Configuración por slug o id con caché corta en memoria (los cambios del admin se ven en
 * segundos). Se cachea la promesa para que N requests simultáneas hagan una sola carga.
 */
export class RepoClubs {
  private readonly cache = new Map<string, { vence: number; valor: Promise<ConfigClub | null> }>();

  constructor(
    private readonly db: Db,
    private readonly ttlMs: number,
  ) {}

  porSlug(slug: string): Promise<ConfigClub | null> {
    return this.cacheado(`slug:${slug.toLowerCase()}`, eq(clubs.slug, slug.toLowerCase()));
  }

  /** Tras un cambio de configuración desde el panel: la próxima lectura va a la base. */
  invalidar() {
    this.cache.clear();
  }

  porId(id: string): Promise<ConfigClub | null> {
    return this.cacheado(`id:${id}`, eq(clubs.id, id));
  }

  private cacheado(clave: string, condicion: SQL): Promise<ConfigClub | null> {
    const enCache = this.cache.get(clave);
    if (enCache && enCache.vence > Date.now()) return enCache.valor;

    const valor = this.cargar(condicion);
    this.cache.set(clave, { vence: Date.now() + this.ttlMs, valor });
    valor.catch(() => this.cache.delete(clave));
    return valor;
  }

  private async cargar(condicion: SQL): Promise<ConfigClub | null> {
    const [fila] = await this.db
      .select({
        id: clubs.id,
        slug: clubs.slug,
        nombre: clubs.nombre,
        zonaHoraria: clubs.zonaHoraria,
        telefono: clubs.telefono,
        direccion: clubs.direccion,
        logoUrl: clubs.logoUrl,
        moneda: clubs.moneda,
        minutosRevisionTransferencia: clubs.minutosRevisionTransferencia,
        tieneMp: sql<boolean>`${clubs.mpCredencialesCifradas} IS NOT NULL`,
        datosTransferencia: clubs.datosTransferencia,
      })
      .from(clubs)
      .where(and(condicion, eq(clubs.activo, true)));
    if (!fila) return null;
    const { tieneMp, datosTransferencia, ...club } = fila;

    const [listaCanchas, horarios, especiales, listaTarifas, reglas] = await Promise.all([
      this.db
        .select({
          id: canchas.id,
          nombre: canchas.nombre,
          jugadoresPorLado: canchas.jugadoresPorLado,
          superficie: canchas.superficie,
          techada: canchas.techada,
          iluminacion: canchas.iluminacion,
          caracteristicas: canchas.caracteristicas,
          duracionTurnoMin: canchas.duracionTurnoMin,
        })
        .from(canchas)
        .where(and(eq(canchas.clubId, club.id), eq(canchas.activa, true)))
        .orderBy(asc(canchas.orden), asc(canchas.nombre)),
      this.db
        .select({
          diaSemana: horariosApertura.diaSemana,
          abre: horariosApertura.abre,
          cierra: horariosApertura.cierra,
        })
        .from(horariosApertura)
        .where(eq(horariosApertura.clubId, club.id)),
      this.db
        .select({
          fecha: diasEspeciales.fecha,
          cerrado: diasEspeciales.cerrado,
          abre: diasEspeciales.abre,
          cierra: diasEspeciales.cierra,
        })
        .from(diasEspeciales)
        .where(and(eq(diasEspeciales.clubId, club.id), gte(diasEspeciales.fecha, sql`CURRENT_DATE - 1`))),
      this.db
        .select({
          canchaId: tarifas.canchaId,
          diaSemana: tarifas.diaSemana,
          horaDesde: tarifas.horaDesde,
          horaHasta: tarifas.horaHasta,
          precio: tarifas.precio,
          vigenteDesde: tarifas.vigenteDesde,
          vigenteHasta: tarifas.vigenteHasta,
        })
        .from(tarifas)
        .where(eq(tarifas.clubId, club.id)),
      this.db
        .select({
          canchaId: configuracionExpiracion.canchaId,
          diaSemana: configuracionExpiracion.diaSemana,
          horaDesde: configuracionExpiracion.horaDesde,
          horaHasta: configuracionExpiracion.horaHasta,
          requiereSena: configuracionExpiracion.requiereSena,
          tipoSena: configuracionExpiracion.tipoSena,
          valorSena: configuracionExpiracion.valorSena,
          minutosExpiracion: configuracionExpiracion.minutosExpiracion,
          margenMinAntesInicio: configuracionExpiracion.margenMinAntesInicio,
          prioridad: configuracionExpiracion.prioridad,
          activa: configuracionExpiracion.activa,
        })
        .from(configuracionExpiracion)
        .where(and(eq(configuracionExpiracion.clubId, club.id), eq(configuracionExpiracion.activa, true))),
    ]);

    return {
      club,
      mediosPago: { mercadoPago: tieneMp, transferencia: datosTransferencia },
      canchas: listaCanchas,
      horarios,
      especiales,
      tarifas: listaTarifas,
      reglas,
    };
  }
}
