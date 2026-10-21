import { crearDb } from '@cancheria/db';
import { construirApp } from './app.ts';
import { cargarConfig } from './config.ts';

const config = cargarConfig();
const { db, cliente, cerrar } = crearDb(config.databaseUrl, { max: 20 });
const app = await construirApp({ db, cliente, config });

const apagar = async (senal: string) => {
  app.log.info(`${senal}: cerrando…`);
  await app.close();
  await cerrar();
  process.exit(0);
};
process.once('SIGINT', () => void apagar('SIGINT'));
process.once('SIGTERM', () => void apagar('SIGTERM'));

await app.listen({ port: config.puerto, host: config.host });
