import pino from 'pino';

/**
 * Logger estruturado do serviço de verificação web.
 *
 * - Dev: pretty-print colorido
 * - Produção (NODE_ENV=production): JSON puro para stdout
 *
 * Redact (LGPD): API key nunca entra nos logs. CPF/e-mail são tratados como
 * dados pessoais e redacted também.
 */

const isProd = process.env.NODE_ENV === 'production';

const REDACT_PATHS = [
  'apiKey',
  '*.apiKey',
  'api_key',
  '*.api_key',
  'x-api-key',
  'password',
  '*.password',
  'token',
  '*.token',
  'cpf',
  '*.cpf',
  'email',
  '*.email',
];

export const logger = pino({
  name: 'verificacao-web',
  level: isProd ? 'info' : 'debug',
  base: { servico: 'verificacao-web', env: isProd ? 'production' : 'development' },
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }),
});
