import pino, { type Logger } from 'pino';

/**
 * Factory pura para criar loggers pino com config padronizada e redact LGPD.
 *
 * Separada de logger.ts (que importa electron) para permitir testes sem
 * subir o runtime do Electron. Em produção, logger.ts cria o singleton
 * usando essa factory.
 */

export type { Logger };

export type Ambiente = 'development' | 'production' | 'test';

export interface OpcoesLogger {
  /** Ambiente — define nível default e formato. */
  env: Ambiente;
  /** Nome do logger (default: 'nexa-class'). */
  nome?: string;
  /** Stream de saída — default: process.stdout. Útil para testes. */
  stream?: NodeJS.WriteStream | NodeJS.WritableStream;
}

// Paths redacted em qualquer nível (topo ou aninhado via wildcard).
// Exportado para teste e auditoria.
export const REDACT_PATHS = [
  // Credenciais
  'password',
  '*.password',
  'password_hash',
  '*.password_hash',
  'senha',
  '*.senha',
  'novaSenha',
  '*.novaSenha',
  'senhaAtual',
  '*.senhaAtual',
  'masterPassword',
  '*.masterPassword',
  // Tokens / códigos
  'token',
  '*.token',
  'reset_token',
  '*.reset_token',
  'codigo',
  '*.codigo',
  'apiKey',
  '*.apiKey',
  'api_key',
  '*.api_key',
  'x-api-key',
  // SMTP
  'smtp.pass',
  '*.pass',
  // Dados pessoais (LGPD)
  'email',
  '*.email',
  'cpf',
  '*.cpf',
  // Foto path contém userData do usuário (caminho pessoal no Windows)
  'foto_path',
  '*.foto_path',
] as const;

/**
 * Cria um logger pino com config padronizada e redact LGPD.
 * Pure function — sem dependência de electron — para permitir testes.
 */
export function criarLogger(opts: OpcoesLogger): Logger {
  const isDev = opts.env === 'development';
  const config = {
    name: opts.nome ?? 'nexa-class',
    level: isDev ? 'debug' : 'info',
    base: { app: opts.nome ?? 'nexa-class', env: opts.env },
    redact: {
      paths: [...REDACT_PATHS],
      censor: '[REDACTED]',
    },
  };

  // Em dev SEM stream custom: usa transport pretty para stdout.
  if (isDev && !opts.stream) {
    return pino({
      ...config,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  // Caso contrário: JSON direto para o stream (stdout ou custom p/ testes).
  // pino aceita o stream como SEGUNDO argumento, não dentro de options.
  return opts.stream ? pino(config, opts.stream as any) : pino(config);
}
