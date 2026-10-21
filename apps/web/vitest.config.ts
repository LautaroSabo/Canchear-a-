import { defineConfig } from 'vitest/config';

// Solo tests unitarios; los de e2e/ son de Playwright (pnpm test:e2e).
export default defineConfig({ test: { include: ['lib/**/*.test.ts', 'componentes/**/*.test.ts'] } });
