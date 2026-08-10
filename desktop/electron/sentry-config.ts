/**
 * Configuração de Sentry para o desktop — função pura, sem import do SDK.
 *
 * Separada de sentry.ts (que importa @sentry/electron/main e quebra em testes
 * sem Electron runtime) para permitir testar a validação isoladamente.
 */

export interface SentryInitOpts {
  dsn?: string;
  environment?: string;
  release?: string;
}

/**
 * Valida se a configuração justifica inicializar o Sentry.
 * Retorna null se OK, ou motivo de não inicializar.
 */
export function deveIniciarSentry(opts: SentryInitOpts): string | null {
  if (opts.dsn === undefined || opts.dsn === null) {
    return 'SENTRY_DSN não configurada — Sentry inativo';
  }
  if (opts.dsn.trim() === '') return 'SENTRY_DSN vazia — Sentry inativo';
  if (opts.dsn === 'placeholder' || opts.dsn.startsWith('your-dsn')) {
    return 'SENTRY_DSN parece placeholder — Sentry inativo';
  }
  return null;
}
