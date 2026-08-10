import { defineConfig } from 'vitest/config';

// Vitest config do serviço web público de verificação.
// Sem React/jsdom aqui — apenas Node puro (Express + SQLite).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/**', 'dist/**', '**/*.test.*', 'vitest.config.ts'],
    },
  },
});
