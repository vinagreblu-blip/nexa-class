import { defineConfig } from '@playwright/test';

/**
 * Config do Playwright Electron para testes E2E do app desktop.
 *
 * Estratégia:
 *  - Builda o app (vite build + tsc electron) antes dos testes
 *  - Lança Electron com env NEXA_E2E=1 para forçar carregamento de dist/
 *    (sem precisar do Vite dev server rodando)
 *  - DB e SMTP continuam funcionando em tmp/userData isolado por teste
 *
 * Testes smoke mantidos mínimos — a maior parte da lógica está coberta por
 * testes unitários em vitest. E2E foca em garantir que o app abre e o fluxo
 * de login aparece corretamente.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    trace: 'retain-on-failure',
  },
  // Não rodar servidor web — Electron é lançado pelos próprios testes.
  webServer: undefined,
});
