import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { app } from 'electron';
import { criarLogger, type Logger } from './logger-factory';

/**
 * Logger singleton do app desktop.
 *
 * - Dev (não empacotado): pretty-print colorido para stdout (legível no terminal)
 * - Produção (empacotado): JSON em tee — stdout E arquivo diário em
 *   `<userData>/logs/nexa-AAAA-MM-DD.log`. App GUI no Windows não tem console:
 *   sem o arquivo, os logs de produção seriam perdidos (diagnóstico remoto
 *   impossível — ex.: falhas de PIN do token A3 em outra máquina).
 *
 * Redact (LGPD): campos sensíveis NUNCA entram nos logs — substituídos por '[REDACTED]'.
 * Cobre senhas, tokens, hashes, API keys e e-mails (dado pessoal segundo LGPD).
 *
 * Ver logger-factory.ts pela factory pura (testável sem electron).
 */

/** Mantém referência para fechar no quit (flush do append pendente). */
let streamArquivo: fs.WriteStream | null = null;

/** Writable que replica cada chunk para dois destinos (stdout + arquivo). */
class TeeStream extends Writable {
  constructor(
    private readonly a: NodeJS.WritableStream,
    private readonly b: NodeJS.WritableStream
  ) {
    super();
  }
  _write(chunk: any, _enc: string, cb: (err?: Error | null) => void): void {
    try {
      this.a.write(chunk);
      this.b.write(chunk);
      cb();
    } catch (e) {
      cb(e as Error);
    }
  }
}

/**
 * Cria o tee de produção. Se o disco/permissionamento falhar (ex.: userData
 * só-leitura), degrada silenciosamente para stdout — logging nunca pode derrubar o app.
 */
function criarStreamProducao(): NodeJS.WritableStream {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const nome = `nexa-${new Date().toISOString().slice(0, 10)}.log`;
    streamArquivo = fs.createWriteStream(path.join(dir, nome), { flags: 'a' });
    // Erros de disco (cheio, removível) não podem virar exceção não tratada.
    streamArquivo.on('error', () => { /* noop — tee continua no stdout */ });
    return new TeeStream(process.stdout, streamArquivo);
  } catch {
    return process.stdout;
  }
}

const empacotado = app.isPackaged;

export const logger: Logger = criarLogger({
  env: empacotado ? 'production' : 'development',
  ...(empacotado ? { stream: criarStreamProducao() } : {}),
});

// Flush do arquivo de log antes de sair (append é assíncrono).
app.on('before-quit', () => {
  try { streamArquivo?.end(); } catch { /* noop */ }
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
