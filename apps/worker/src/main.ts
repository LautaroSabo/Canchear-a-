import { crearDb } from '@cancheria/db';
import {
  AlmacenMemoria,
  CanalConsola,
  CanalCorreo,
  CanalSinConfigurar,
  CanalWhatsApp,
  Cifrador,
  crearCorreo,
  Despachador,
  iniciarAvisoErrores,
  PasarelaMpHttp,
  RepoClubs,
  ServicioAuth,
  ServicioExpiracion,
  ServicioListaEspera,
  ServicioPagos,
  ServicioReembolsos,
  ServicioTurnosFijos,
} from '@cancheria/servicios';
import pino from 'pino';
import { cargarConfig } from './config.ts';
import { Programador } from './programador.ts';

const config = cargarConfig();
const aviso = iniciarAvisoErrores({
  dsn: config.sentryDsn,
  servicio: 'worker',
  version: process.env.RAILWAY_GIT_COMMIT_SHA,
});
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
// WhatsApp para lo urgente (lugar liberado de la lista de espera); mail para lo demás.
// Un medio sin configurar: en desarrollo imprime el aviso; en producción queda fallido
// con el motivo, a la vista en el panel (Mensajes).
const correo = crearCorreo(config.correo);
const despachador = new Despachador(db, reloj, {
  WHATSAPP: config.whatsapp
    ? new CanalWhatsApp(config.whatsapp)
    : config.desarrollo
      ? new CanalConsola((l) => log.info(l), 'whatsapp')
      : new CanalSinConfigurar('WhatsApp sin configurar (WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID)'),
  EMAIL: correo
    ? new CanalCorreo(correo)
    : config.desarrollo
      ? new CanalConsola((l) => log.info(l), 'mail')
      : new CanalSinConfigurar('Mail sin configurar (RESEND_API_KEY o SMTP_*)'),
});
const auth = new ServicioAuth(entorno);
const turnosFijos = new ServicioTurnosFijos({ ...entorno, clubs, listaEspera });

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
    {
      // Cada hora: el horizonte avanza de a un día, y si un turno fijo choca con algo el
      // club se entera con tiempo.
      nombre: 'materializar-turnos-fijos',
      cadaMs: config.intervalos.turnosFijosMs,
      ejecutar: () => turnosFijos.materializarPendientes(),
    },
  ],
  log,
  (err, contexto) => aviso.capturar(err, contexto),
);

const apagar = async (senal: string) => {
  log.info(`${senal}: esperando que terminen las tareas en curso…`);
  await programador.detener();
  await cerrar();
  await aviso.cerrar();
  process.exit(0);
};
process.once('SIGINT', () => void apagar('SIGINT'));
process.once('SIGTERM', () => void apagar('SIGTERM'));

log.info({ whatsapp: Boolean(config.whatsapp) }, 'worker iniciado');
programador.iniciar();
