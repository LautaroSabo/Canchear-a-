import { defineConfig, devices } from '@playwright/test';

const API = 'http://localhost:3101';
const WEB = 'http://localhost:3100';

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
      env: { PORT: '3101', WEB_ORIGIN: WEB, URL_WEB: WEB, URL_API: API },
      timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    },
    {
      command:
        'node node_modules/next/dist/bin/next build && node node_modules/next/dist/bin/next start -p 3100',
      url: WEB,
      env: { NEXT_PUBLIC_API_URL: API, NEXT_DIST_DIR: '.next-e2e', NEXT_TELEMETRY_DISABLED: '1' },
      timeout: 300_000,
    },
  ],
});
