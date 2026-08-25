import { defineConfig } from 'vitest/config';

// Vitest config do serviço web público de verificação.
// Sem React/jsdom aqui — apenas Node puro (Express + SQLite).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts'],
    // better-sqlite3 (nativo) + forks paralelos crasha o worker no runner do
    // GitHub Actions ("Worker exited unexpectedly") desde a v1.2.15. Um fork
    // único carrega o módulo nativo uma vez e é estável; a suíte é pequena
    // (51 testes, ~1s) — sem ganho relevante em paralelizar.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/**', 'dist/**', '**/*.test.*', 'vitest.config.ts'],
    },
  },
});
