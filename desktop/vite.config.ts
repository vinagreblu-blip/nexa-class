import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Insere o CSP rígido (defense-in-depth) SOMENTE no build de produção.
// Em dev o Electron injeta via header um CSP permissivo (aplicarCsp em main.ts);
// ter um meta CSP estático em dev quebraria o React Refresh/HMR do Vite, pois
// múltiplas políticas CSP são aplicadas em conjunto (a mais restritiva vence).
function cspMetaProd(): Plugin {
  return {
    name: 'csp-meta-prod',
    apply: 'build',
    transformIndexHtml(html: string) {
      const tags = [
        '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; font-src \'self\' data:; object-src \'none\'; base-uri \'self\'; frame-ancestors \'none\'; form-action \'self\'" />',
        '<meta http-equiv="X-Content-Type-Options" content="nosniff" />',
      ].join('\n    ');
      return html.replace('<!--CSP-->', tags);
    },
  };
}

export default defineConfig({
  plugins: [react(), cspMetaProd()],
  base: './',
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
