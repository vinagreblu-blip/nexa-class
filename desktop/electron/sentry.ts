// @sentry/electron v3+ exige import específico por processo.
// main = processo principal do Electron (este arquivo); renderer seria '@sentry/electron/renderer'.
import { init } from '@sentry/electron/main';
import { deveIniciarSentry, type SentryInitOpts } from './sentry-config';

export type { SentryInitOpts };
export { deveIniciarSentry };

/**
 * Inicializa Sentry no main process do Electron se DSN configurada.
 * Retorna true se ativou, false caso contrário.
 *
 * Deve ser chamado O MAIS CEDO POSSÍVEL no main.ts, antes de qualquer
 * outro código, para garantir que hooks globais de erro estejam em lugar.
 */
export function initSentryDesktop(opts: SentryInitOpts): boolean {
  const motivo = deveIniciarSentry(opts);
  if (motivo) return false;

  init({
    dsn: opts.dsn!,
    environment:
      opts.environment ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development'),
    release: opts.release,
    sendDefaultPii: false,
    // 10% traces (baixo overhead em Electron).
    tracesSampleRate: 0.1,
  });
  return true;
}
