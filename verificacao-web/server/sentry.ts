import { init, type NodeOptions } from '@sentry/node';

/**
 * Inicialização do Sentry para o serviço web (Node puro).
 *
 * Gated por SENTRY_DSN — se a env não estiver configurada, a função retorna
 * `false` e NÃO chama `init()` (Sentry fica 100% inerte, sem tentar enviar
 * nada). Quando o operador seta SENTRY_DSN (self-hosted GlitchTip ou Sentry
 * cloud), a integração ativa automaticamente.
 *
 * LGPD: por default NÃO capturamos IP do usuário, headers de requisição ou
 * body. Esses dados seriam enviados ao Sentry e fogem do nosso controle.
 * Apenas stack traces e metadados explícitos.
 */

export interface SentryInitOpts {
  dsn?: string;
  environment?: string;
  release?: string;
}

/**
 * Valida se a configuração justifica inicializar o Sentry.
 * Retorna null se OK, ou motivo de não inicializar.
 *
 * Exportada como função pura para permitir testes sem importar @sentry/node.
 */
export function deveIniciarSentry(opts: SentryInitOpts): string | null {
  // undefined/null → "não configurada"; string vazia/espaços → "vazia".
  if (opts.dsn === undefined || opts.dsn === null) {
    return 'SENTRY_DSN não configurada — Sentry inativo';
  }
  if (opts.dsn.trim() === '') return 'SENTRY_DSN vazia — Sentry inativo';
  // DSN do Sentry tem formato: https://<key>@<host>/<id>
  // Não validamos rigorosamente — apenas garante que não é placeholder.
  if (opts.dsn === 'placeholder' || opts.dsn.startsWith('your-dsn')) {
    return 'SENTRY_DSN parece placeholder — Sentry inativo';
  }
  return null;
}

/** Config padrão LGPD-friendly aplicada quando Sentry ativa. */
const DEFAULTS: NodeOptions = {
  // Não enviar IP do servidor/release para o Sentry.
  sendDefaultPii: false,
  // Não capturar body/headers de requisições — podem conter dados pessoais.
  defaultIntegrations: false,
  // 10% de traces de performance (overhead baixo).
  tracesSampleRate: 0.1,
};

/**
 * Inicializa Sentry se DSN válida. Retorna true se ativou, false caso contrário.
 * Idempotente: chamar múltiplas vezes é seguro.
 */
export function initSentry(opts: SentryInitOpts): boolean {
  const motivo = deveIniciarSentry(opts);
  if (motivo) return false;

  init({
    dsn: opts.dsn!,
    environment: opts.environment ?? process.env.NODE_ENV ?? 'development',
    release: opts.release,
    ...DEFAULTS,
  });
  return true;
}
