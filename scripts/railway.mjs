// Build y arranque por servicio en Railway. Los tres servicios (api, worker y web) se
// despliegan del mismo repo; cada uno hace lo suyo según su nombre (RAILWAY_SERVICE_NAME).
// Fuera de Railway, `build` compila todo como siempre.
//   node scripts/railway.mjs build | start
import { spawnSync } from 'node:child_process';

const [modo] = process.argv.slice(2);
const servicio = process.env.RAILWAY_SERVICE_NAME?.trim().toLowerCase();

const PASOS = {
  build: {
    api: [],
    worker: [],
    web: [['pnpm', '--filter', '@cancheria/web', 'build']],
    otro: [['pnpm', 'exec', 'turbo', 'run', 'build']],
  },
  start: {
    // La API aplica las migraciones pendientes antes de arrancar (con un lock: es seguro).
    api: [
      ['pnpm', 'db:migrate'],
      ['pnpm', '--filter', '@cancheria/api', 'start'],
    ],
    worker: [['pnpm', '--filter', '@cancheria/worker', 'start']],
    web: [['pnpm', '--filter', '@cancheria/web', 'start']],
  },
};

if (!PASOS[modo]) {
  console.error('Uso: node scripts/railway.mjs build|start');
  process.exit(1);
}
const pasos = PASOS[modo][servicio ?? 'otro'];
if (!pasos) {
  console.error(
    `✖ No sé qué ${modo === 'start' ? 'arrancar' : 'compilar'} para el servicio "${servicio}". ` +
      'Los servicios de Railway se tienen que llamar api, worker y web.',
  );
  process.exit(1);
}
console.log(`→ ${modo} de ${servicio ?? 'todo el monorepo'}`);
for (const [cmd, ...args] of pasos) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
