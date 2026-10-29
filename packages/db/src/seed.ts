import { eq } from 'drizzle-orm';
import { crearDb, type Db } from './client.ts';
import {
  canchas,
  clubs,
  configuracionExpiracion,
  horariosApertura,
  inventarioCantina,
  premios,
  promocionesPuntos,
  tarifas,
} from './schema/index.ts';

export const SLUG_DEMO = 'la-canchita';
const pesos = (n: number) => n * 100;

/** Carga un club de demo completo. Idempotente: si el club ya existe no hace nada. */
export async function sembrar(url: string) {
  const { db, cerrar } = crearDb(url, { max: 1 });
  try {
    const [existente] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.slug, SLUG_DEMO));
    if (existente) {
      console.log(`El club demo "${SLUG_DEMO}" ya existe; no se cargó nada.`);
      return;
    }

    await crearClubDemo(db);

    console.log(`✔ Club demo cargado: /${SLUG_DEMO}`);
  } finally {
    await cerrar();
  }
}

/**
 * Club completo con la configuración de ejemplo de docs/arquitectura.md: 3 canchas
 * (2×F5 + F7 de 90 min), horarios con cierre después de medianoche el finde, tarifas
 * pico/valle, reglas de seña (general 30 min, finde 10 min, siesta sin seña), cantina,
 * promos y premios. Los tests lo reutilizan con slugs aleatorios.
 */
export function crearClubDemo(db: Db, slug = SLUG_DEMO) {
  return db.transaction(async (tx) => {
    const [club] = await tx
      .insert(clubs)
      .values({
        slug,
        nombre: 'La Canchita F5',
        telefono: '+5491155550000',
        direccion: 'Av. Siempreviva 742, CABA',
        puntosPorPartido: 10,
        datosTransferencia: { alias: 'la.canchita.mp', titular: 'La Canchita SRL' },
      })
      .returning();
    if (!club) throw new Error('No se pudo crear el club demo');
    const clubId = club.id;

    const [c1, c2, c3] = await tx
      .insert(canchas)
      .values([
        {
          clubId,
          nombre: 'Cancha 1',
          jugadoresPorLado: 5,
          orden: 1,
          caracteristicas: { vestuarios: true },
        },
        { clubId, nombre: 'Cancha 2', jugadoresPorLado: 5, orden: 2, techada: true },
        { clubId, nombre: 'Cancha 3', jugadoresPorLado: 7, orden: 3, duracionTurnoMin: 90 },
      ])
      .returning();
    if (!c1 || !c2 || !c3) throw new Error('No se pudieron crear las canchas demo');

    // Lun–vie 10–24, sáb–dom 9–02 (cierra al día siguiente)
    await tx
      .insert(horariosApertura)
      .values(
        [0, 1, 2, 3, 4, 5, 6].map((dia) =>
          dia === 0 || dia === 6
            ? { clubId, diaSemana: dia, abre: '09:00', cierra: '02:00' }
            : { clubId, diaSemana: dia, abre: '10:00', cierra: '00:00' },
        ),
      );

    // Precio general del club para F5 (cancha null) y precio propio para la F7.
    // Vigencia explícita: el default es la fecha de la base en UTC, que de 21 a 24 h de
    // Buenos Aires ya es "mañana" y dejaba sin precio los turnos de esa noche.
    const desde = { vigenteDesde: '2020-01-01' };
    await tx.insert(tarifas).values([
      { clubId, ...desde, horaDesde: '00:00', horaHasta: '18:00', precio: pesos(30_000), etiqueta: 'Valle' },
      { clubId, ...desde, horaDesde: '18:00', horaHasta: '00:00', precio: pesos(45_000), etiqueta: 'Pico' },
      {
        clubId,
        ...desde,
        canchaId: c3.id,
        horaDesde: '00:00',
        horaHasta: '18:00',
        precio: pesos(50_000),
        etiqueta: 'Valle',
      },
      {
        clubId,
        ...desde,
        canchaId: c3.id,
        horaDesde: '18:00',
        horaHasta: '00:00',
        precio: pesos(70_000),
        etiqueta: 'Pico',
      },
    ]);

    await tx.insert(configuracionExpiracion).values([
      { clubId, nombre: 'General', requiereSena: true, valorSena: 50, minutosExpiracion: 30 },
      ...[0, 6].map((dia) => ({
        clubId,
        nombre: dia === 0 ? 'Domingo' : 'Sábado',
        diaSemana: dia,
        requiereSena: true,
        valorSena: 50,
        minutosExpiracion: 10,
      })),
      ...[1, 2, 3, 4, 5].map((dia) => ({
        clubId,
        nombre: 'Siesta sin seña',
        diaSemana: dia,
        horaDesde: '13:00',
        horaHasta: '17:00',
        requiereSena: false,
      })),
    ]);

    await tx.insert(inventarioCantina).values([
      { clubId, nombre: 'Agua 500ml', precio: pesos(1_500), stock: 48, stockMinimo: 12 },
      { clubId, nombre: 'Gatorade 500ml', precio: pesos(2_500), stock: 24, stockMinimo: 6 },
      { clubId, nombre: 'Cerveza lata', precio: pesos(3_000), stock: 48, stockMinimo: 12 },
      {
        clubId,
        nombre: 'Alquiler pelota',
        categoria: 'ALQUILER',
        precio: pesos(2_000),
        controlaStock: false,
      },
      {
        clubId,
        nombre: 'Alquiler pecheras',
        categoria: 'ALQUILER',
        precio: pesos(1_500),
        controlaStock: false,
      },
    ]);

    await tx.insert(promocionesPuntos).values([
      {
        clubId,
        nombre: 'Martes y miércoles valle x2',
        diaSemana: 2,
        horaDesde: '10:00',
        horaHasta: '17:00',
        multiplicador: '2',
      },
      {
        clubId,
        nombre: 'Martes y miércoles valle x2',
        diaSemana: 3,
        horaDesde: '10:00',
        horaHasta: '17:00',
        multiplicador: '2',
      },
    ]);

    await tx.insert(premios).values([
      { clubId, nombre: 'Gatorade gratis', costoPuntos: 50, tipo: 'PRODUCTO' },
      { clubId, nombre: '20% off en un turno', costoPuntos: 150, tipo: 'DESCUENTO_PORCENTAJE', valor: 20 },
      { clubId, nombre: 'Turno F5 gratis (valle)', costoPuntos: 400, tipo: 'TURNO_GRATIS' },
    ]);

    return { club, canchas: [c1, c2, c3] as const };
  });
}
