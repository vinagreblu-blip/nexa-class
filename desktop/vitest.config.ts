import { defineConfig } from 'vitest/config';

// Vitest config do app desktop.
// - environment: 'node' cobre o processo main do Electron e os testes de utils.
//   Para testes do renderer (React), marque `// @vitest-environment jsdom` no topo
//   do arquivo de teste (overrride pontual sem mudar o default do workspace).
// - jsdom fica como dep preventiva para a Fase 5 (UI).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', 'dist/**', 'dist-electron/**', 'release/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'dist-electron/**',
        'release/**',
        '**/*.test.*',
        '**/vite-env.d.ts',
        'vitest.config.ts',
        'vite.config.ts',
      ],
    },
  },
});
