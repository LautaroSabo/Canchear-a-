import { crearDb } from '@cancheria/db';
import { iniciarAvisoErrores } from '@cancheria/servicios';
import { construirApp } from './app.ts';
import { cargarConfig } from './config.ts';

const config = cargarConfig();
const aviso = iniciarAvisoErrores({
  dsn: config.sentryDsn,
  servicio: 'api',
  version: process.env.RAILWAY_GIT_COMMIT_SHA,
});
const { db, cliente, cerrar } = crearDb(config.databaseUrl, { max: 20 });
const app = await construirApp({ db, cliente, config, aviso });

const apagar = async (senal: string) => {
  app.log.info(`${senal}: cerrando…`);
  await app.close();
  await cerrar();
  await aviso.cerrar();
  process.exit(0);
};
process.once('SIGINT', () => void apagar('SIGINT'));
process.once('SIGTERM', () => void apagar('SIGTERM'));

await app.listen({ port: config.puerto, host: config.host });
