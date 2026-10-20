// Solo desarrollo: borra todo, migra de cero y carga datos de demo.
import postgres from 'postgres';
import { urlDesdeEntorno } from '../client.ts';
import { migrar } from '../migrador.ts';
import { sembrar } from '../seed.ts';
import { ejecutar } from './ejecutar.ts';

await ejecutar(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('db:reset está deshabilitado en producción');
  const url = urlDesdeEntorno();
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } finally {
    await sql.end();
  }
  await migrar(url);
  await sembrar(url);
});
