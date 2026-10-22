import { randomUUID } from 'node:crypto';
import { crearClubDemo, crearDb } from '@cancheria/db';
import { clientes, notificaciones, pagos, reembolsos, turnos, usuarios } from '@cancheria/db/schema';
import { clonarBaseDeTest } from '@cancheria/db/testing';
import { eq } from 'drizzle-orm';
import { inject } from 'vitest';
import { AlmacenMemoria } from '../src/almacen.ts';
import { ServicioAuth } from '../src/auth.ts';
import { ServicioCantina } from '../src/cantina.ts';
import { Cifrador } from '../src/cifrado.ts';
import { RepoClubs } from '../src/config-club.ts';
import { ServicioConfiguracion } from '../src/configuracion.ts';
import { cotizarTurno } from '../src/cotizacion.ts';
import { guardarCredencialesMp } from '../src/credenciales.ts';
import { ServicioExpiracion } from '../src/expiracion.ts';
import { ServicioFidelizacion } from '../src/fidelizacion.ts';
import { ServicioListaEspera } from '../src/lista-espera.ts';
import { PasarelaMpFalsa } from '../src/mercadopago/falsa.ts';
import { CanalMemoria } from '../src/notificaciones/canales.ts';
import { Despachador } from '../src/notificaciones/despachador.ts';
import { ServicioOperacion } from '../src/operacion.ts';
import { ServicioPagos } from '../src/pagos.ts';
import { ServicioReembolsos } from '../src/reembolsos.ts';
import { ServicioTurnosFijos } from '../src/turnos-fijos.ts';

/** Viernes 2030-01-04 12:00 en Buenos Aires. */
export const AHORA = new Date('2030-01-04T12:00:00-03:00');
export const ba = (fecha: string, hora: string) => new Date(`${fecha}T${hora}:00-03:00`);
export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);

/**
 * Todos los servicios contra una base propia (clonada de la plantilla migrada), con
 * MP / WhatsApp / almacén falsos. Base propia porque el worker barre la base entera.
 */
export async function crearContexto({ conMp = true, pool = 10 } = {}) {
  const base = await clonarBaseDeTest(inject('databaseUrl'));
  const { db, cerrar: cerrarPool } = crearDb(base.url, { max: pool });
  const cerrar = async () => {
    await cerrarPool();
    await base.borrar();
  };
  let ahora = AHORA;
  const reloj = () => ahora;
  const pasarela = new PasarelaMpFalsa();
  const cifrador = new Cifrador(Cifrador.generarClave());
  const almacen = new AlmacenMemoria();
  const canal = new CanalMemoria();
  const clubs = new RepoClubs(db, 0);
  const entorno = { db, reloj, urlWeb: 'https://cancheria.test', urlApi: 'https://api.cancheria.test' };

  const servicioPagos = new ServicioPagos({ ...entorno, pasarela, cifrador, almacen });
  const listaEspera = new ServicioListaEspera({ ...entorno, clubs });
  const expiracion = new ServicioExpiracion({
    ...entorno,
    pagos: servicioPagos,
    listaEspera,
    log: { warn: () => {} },
  });
  const servicioReembolsos = new ServicioReembolsos({ ...entorno, pasarela, cifrador });
  const operacion = new ServicioOperacion({ ...entorno, clubs, listaEspera });
  const auth = new ServicioAuth(entorno);
  const configuracion = new ServicioConfiguracion({ ...entorno, clubs });
  const turnosFijos = new ServicioTurnosFijos({ ...entorno, clubs, listaEspera });
  const cantina = new ServicioCantina({ ...entorno, clubs });
  const fidelizacion = new ServicioFidelizacion(entorno);
  const despachador = new Despachador(db, reloj, canal);

  const slug = `club-${randomUUID().slice(0, 8)}`;
  const { club, canchas } = await crearClubDemo(db, slug);
  if (conMp) {
    await guardarCredencialesMp(db, cifrador, club.id, {
      accessToken: 'TEST-token',
      webhookSecret: 'secreto',
    });
  }
  const [f5a, f5b, f7] = canchas;
  const [usuario] = await db
    .insert(usuarios)
    .values({ email: `admin@${slug}.test`, nombre: 'Recepción', passwordHash: 'x' })
    .returning();

  let n = 0;
  const ctx = {
    db,
    club,
    slug,
    usuario: usuario!,
    canchas: { f5a, f5b, f7 },
    pasarela,
    almacen,
    canal,
    clubs,
    pagos: servicioPagos,
    listaEspera,
    expiracion,
    reembolsos: servicioReembolsos,
    despachador,
    operacion,
    auth,
    configuracion,
    turnosFijos,
    cantina,
    fidelizacion,
    ahora: () => ahora,
    setAhora: (d: Date) => {
      ahora = d;
    },
    avanzar: (minutos: number) => {
      ahora = new Date(ahora.getTime() + minutos * 60_000);
    },
    async cliente(telefono = `+54911${String(60_000_000 + ++n)}`) {
      const [c] = await db
        .insert(clientes)
        .values({ clubId: club.id, nombre: `Cliente ${telefono.slice(-4)}`, telefonoE164: telefono })
        .returning();
      return c!;
    },
    /** Hold como lo crea la API: precio y seña según tarifa, timer según la regla del día. */
    async hold(cancha = f5a!, inicio = ba('2030-01-05', '20:00'), clienteId?: string, minutos = 10) {
      const cfg = (await clubs.porId(club.id))!;
      const cot = cotizarTurno(cfg, cancha, inicio)!;
      const [t] = await db
        .insert(turnos)
        .values({
          clubId: club.id,
          canchaId: cancha.id,
          clienteId: clienteId ?? (await ctx.cliente()).id,
          inicio,
          fin: new Date(inicio.getTime() + cancha.duracionTurnoMin * 60_000),
          estado: 'PRE_RESERVADO',
          origen: 'WEB',
          precioTotal: cot.precio,
          montoSena: cot.montoSena,
          expiraEn: new Date(ahora.getTime() + minutos * 60_000),
        })
        .returning();
      return t!;
    },
    turno: async (id: string) => (await db.select().from(turnos).where(eq(turnos.id, id)))[0]!,
    pagosDe: (turnoId: string) =>
      db.select().from(pagos).where(eq(pagos.turnoId, turnoId)).orderBy(pagos.creadoEn),
    reembolsosDe: (pagoId: string) => db.select().from(reembolsos).where(eq(reembolsos.pagoId, pagoId)),
    mensajes: async (plantilla?: string) =>
      (await db.select().from(notificaciones).where(eq(notificaciones.clubId, club.id))).filter(
        (m) => !plantilla || m.plantilla === plantilla,
      ),
    cerrar,
  };
  return ctx;
}

export type Contexto = Awaited<ReturnType<typeof crearContexto>>;
