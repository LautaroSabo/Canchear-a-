import { defineConfig, devices } from '@playwright/test';

const API = 'http://localhost:3101';
const WEB = 'http://localhost:3100';
// E2E_MISMO_ORIGEN=1: la web sirve la API en /api (como en Railway sin dominio propio).
const MISMO_ORIGEN = process.env.E2E_MISMO_ORIGEN === '1';

// Levanta una API con base temporal (apps/api/src/e2e.ts) y el front compilado contra ella.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    locale: 'es-AR',
    // A propósito en UTC: el club está en Buenos Aires y todas las horas tienen que
    // verse en la zona del club, no en la del navegador.
    timezoneId: 'UTC',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node --env-file-if-exists=../../.env --import tsx src/e2e.ts',
      cwd: '../api',
      url: `${API}/health`,
      env: {
        PORT: '3101',
        WEB_ORIGIN: WEB,
        URL_WEB: WEB,
        URL_API: MISMO_ORIGEN ? `${WEB}/api` : API,
        ...(MISMO_ORIGEN ? { COOKIE_RUTA: '/api/admin' } : {}),
      },
      timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    },
    {
      command:
        'node node_modules/next/dist/bin/next build && node node_modules/next/dist/bin/next start -p 3100',
      url: WEB,
      env: {
        NEXT_PUBLIC_API_URL: MISMO_ORIGEN ? '/api' : API,
        ...(MISMO_ORIGEN ? { API_URL_INTERNA: API } : {}),
        NEXT_DIST_DIR: MISMO_ORIGEN ? '.next-e2e-origen' : '.next-e2e',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      timeout: 300_000,
    },
  ],
});
