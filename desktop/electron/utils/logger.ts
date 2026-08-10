import { app } from 'electron';
import { criarLogger, type Logger } from './logger-factory';

/**
 * Logger singleton do app desktop.
 *
 * - Dev (não empacotado): pretty-print colorido para stdout (legível no terminal)
 * - Produção (empacotado): JSON puro para stdout (parseável por journald/CloudWatch/etc.)
 * - Nível: debug em dev, info em prod
 *
 * Redact (LGPD): campos sensíveis NUNCA entram nos logs — substituídos por '[REDACTED]'.
 * Cobre senhas, tokens, hashes, API keys e e-mails (dado pessoal segundo LGPD).
 *
 * Ver logger-factory.ts para a factory pura (testável sem electron).
 *
 * Note: pino-pretty é devDep — em produção o JSON é emitido direto (sem transport),
 * então não há custo extra.
 */

export const logger: Logger = criarLogger({
  env: app.isPackaged ? 'production' : 'development',
});

/**
 * Cria um logger filho com contexto adicional (ex.: requestId, modulo).
 * Útil para rastrear qual usuário/operador disparou o evento.
 *
 * Ex.: const log = logger.child({ modulo: 'declaracao', usuarioId: 42 });
 *      log.info({ alunoId: 99 }, 'declaração emitida');
 */
export function criarLoggerContexto(contexto: Record<string, unknown>): Logger {
  return logger.child(contexto);
}

// Re-exporta para consumidores que precisam da factory ou tipos.
export { criarLogger, REDACT_PATHS } from './logger-factory';
export type { Ambiente, OpcoesLogger } from './logger-factory';
