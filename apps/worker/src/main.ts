import { crearDb } from '@cancheria/db';
import {
  AlmacenMemoria,
  CanalConsola,
  CanalWhatsApp,
  Cifrador,
  Despachador,
  PasarelaMpHttp,
  RepoClubs,
  ServicioAuth,
  ServicioExpiracion,
  ServicioListaEspera,
  ServicioPagos,
  ServicioReembolsos,
} from '@cancheria/servicios';
import pino from 'pino';
import { cargarConfig } from './config.ts';
import { Programador } from './programador.ts';

const config = cargarConfig();
const log = pino({
  level: config.nivelLog,
  ...(config.logsLegibles ? { transport: { target: 'pino-pretty' } } : {}),
});

const { db, cerrar } = crearDb(config.databaseUrl, { max: 5 });
const reloj = () => new Date();
const pasarela = new PasarelaMpHttp();
const cifrador = new Cifrador(config.claveCredenciales);
const entorno = { db, reloj, urlWeb: config.urlWeb };

const clubs = new RepoClubs(db, 30_000);
const listaEspera = new ServicioListaEspera({ ...entorno, clubs });
// El worker no crea checkouts ni recibe archivos: almacén y urlApi no se usan acá.
const pagos = new ServicioPagos({
  ...entorno,
  pasarela,
  cifrador,
  almacen: new AlmacenMemoria(),
  urlApi: '',
});
const expiracion = new ServicioExpiracion({ ...entorno, pagos, listaEspera, log });
const reembolsos = new ServicioReembolsos({ ...entorno, pasarela, cifrador });
const canal = config.whatsapp ? new CanalWhatsApp(config.whatsapp) : new CanalConsola((l) => log.info(l));
const despachador = new Despachador(db, reloj, canal);
const auth = new ServicioAuth(entorno);

const programador = new Programador(
  [
    { nombre: 'expirar-holds', cadaMs: config.intervalos.expiracionMs, ejecutar: () => expiracion.barrer() },
    {
      nombre: 'notificaciones',
      cadaMs: config.intervalos.notificacionesMs,
      ejecutar: () => despachador.procesar(),
    },
    { nombre: 'reembolsos', cadaMs: config.intervalos.reembolsosMs, ejecutar: () => reembolsos.procesar() },
    {
      nombre: 'vencer-lista-espera',
      cadaMs: config.intervalos.listaEsperaMs,
      ejecutar: () => listaEspera.vencerViejas(),
    },
    {
      nombre: 'purgar-sesiones',
      cadaMs: config.intervalos.sesionesMs,
      ejecutar: () => auth.purgarVencidas(),
    },
  ],
  log,
);

const apagar = async (senal: string) => {
  log.info(`${senal}: esperando que terminen las tareas en curso…`);
  await programador.detener();
  await cerrar();
  process.exit(0);
};
process.once('SIGINT', () => void apagar('SIGINT'));
process.once('SIGTERM', () => void apagar('SIGTERM'));

log.info({ whatsapp: Boolean(config.whatsapp) }, 'worker iniciado');
programador.iniciar();
