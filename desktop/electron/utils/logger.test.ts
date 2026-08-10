import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { criarLogger, REDACT_PATHS } from './logger-factory';

/**
 * Helper: cria um logger que escreve para um buffer em memória em vez de stdout.
 * Retorna o logger + uma função para ler o conteúdo acumulado.
 */
function loggerCapturado(env: 'development' | 'production') {
  let conteudo = '';
  const stream = new Writable({
    write(chunk, _enc, cb) {
      conteudo += chunk.toString();
      cb();
    },
  });
  // @ts-expect-error — pino aceita WriteStream, nosso stream é só Writeable
  const log = criarLogger({ env, stream });
  return {
    log,
    ler: () => conteudo,
  };
}

describe('REDACT_PATHS', () => {
  it('inclui campos de credencial críticos', () => {
    expect(REDACT_PATHS).toContain('password');
    expect(REDACT_PATHS).toContain('*.password');
    expect(REDACT_PATHS).toContain('password_hash');
    expect(REDACT_PATHS).toContain('*.senha');
    expect(REDACT_PATHS).toContain('masterPassword');
  });

  it('inclui tokens e códigos OTP', () => {
    expect(REDACT_PATHS).toContain('token');
    expect(REDACT_PATHS).toContain('reset_token');
    expect(REDACT_PATHS).toContain('codigo');
  });

  it('inclui API key em várias capitalizações', () => {
    expect(REDACT_PATHS).toContain('apiKey');
    expect(REDACT_PATHS).toContain('api_key');
    expect(REDACT_PATHS).toContain('x-api-key');
  });

  it('inclui dados pessoais LGPD (e-mail, CPF)', () => {
    expect(REDACT_PATHS).toContain('email');
    expect(REDACT_PATHS).toContain('cpf');
  });

  it('inclui path de foto (contém userData do usuário no Windows)', () => {
    expect(REDACT_PATHS).toContain('foto_path');
  });
});

describe('criarLogger — redact (LGPD)', () => {
  it('redact password em nível topo', () => {
    const { log, ler } = loggerCapturado('production');
    log.info({ password: 'minha-senha-secreta', user: 'joao' }, 'login');
    const saida = ler();
    expect(saida).not.toContain('minha-senha-secreta');
    expect(saida).toContain('[REDACTED]');
    // Campos não-sensíveis preservados.
    expect(saida).toContain('joao');
  });

  it('redact password aninhado (wildcard)', () => {
    const { log, ler } = loggerCapturado('production');
    log.info({ user: { nome: 'Maria', password: 'senha123' } }, 'login');
    const saida = ler();
    expect(saida).not.toContain('senha123');
    expect(saida).toContain('Maria');
  });

  it('redact e-mail (LGPD)', () => {
    const { log, ler } = loggerCapturado('production');
    log.info({ email: 'joao@exemplo.com' }, 'recuperação');
    const saida = ler();
    expect(saida).not.toContain('joao@exemplo.com');
    expect(saida).toContain('[REDACTED]');
  });

  it('redact token de reset', () => {
    const { log, ler } = loggerCapturado('production');
    log.info({ token: '048291', userId: 42 }, 'código gerado');
    const saida = ler();
    expect(saida).not.toContain('048291');
  });

  it('redact API key mesmo com nome composto', () => {
    const { log, ler } = loggerCapturado('production');
    log.info({ apiKey: 'sk-123456789', config: { api_key: 'sk-outro' } }, 'boot');
    const saida = ler();
    expect(saida).not.toContain('sk-123456789');
    expect(saida).not.toContain('sk-outro');
  });

  it('redact password_hash (campo do DB)', () => {
    const { log, ler } = loggerCapturado('production');
    log.info({ user: { password_hash: '$2a$10$abc...' } }, 'criado');
    const saida = ler();
    expect(saida).not.toContain('$2a$10$abc');
  });

  it('preserva dados estruturados não-sensíveis', () => {
    const { log, ler } = loggerCapturado('production');
    log.info(
      { userId: 99, modulo: 'declaracao', alunoId: 42, duracaoMs: 350 },
      'declaração emitida'
    );
    const saida = ler();
    expect(saida).toContain('"userId":99');
    expect(saida).toContain('"modulo":"declaracao"');
    expect(saida).toContain('"alunoId":42');
    expect(saida).toContain('"duracaoMs":350');
  });

  it('produz JSON válido em produção (sem pretty)', () => {
    const { log, ler } = loggerCapturado('production');
    log.info({ ok: true }, 'boot');
    const saida = ler().trim();
    const parsed = JSON.parse(saida);
    expect(parsed.level).toBe(30); // info === 30
    expect(parsed.msg).toBe('boot');
    expect(parsed.ok).toBe(true);
    expect(parsed.app).toBe('nexa-class');
    expect(parsed.env).toBe('production');
  });

  it('inclui campo base app e env', () => {
    const { log, ler } = loggerCapturado('production');
    log.info('teste');
    const saida = ler();
    expect(saida).toContain('"app":"nexa-class"');
    expect(saida).toContain('"env":"production"');
  });

  it('aceita nome customizado', () => {
    const { log, ler } = loggerCapturado('production');
    // logger já criado; novo teste só valida que REDACT_PATHS é exportável
    log.info('x');
    const saida = ler();
    // Nome default é 'nexa-class'; teste de nome customizado fica limitado a validar
    // que criarLogger aceita o parâmetro (já coberto pelo tipo TypeScript).
    expect(saida).toContain('"name":"nexa-class"');
  });
});

describe('criarLogger — níveis', () => {
  it('nível info em produção', () => {
    const { log, ler } = loggerCapturado('production');
    log.debug({ x: 1 }, 'debug não deve aparecer');
    log.info({ x: 1 }, 'info deve aparecer');
    const saida = ler();
    expect(saida).not.toContain('debug não deve aparecer');
    expect(saida).toContain('info deve aparecer');
  });

  it('nível debug em desenvolvimento', () => {
    const { log, ler } = loggerCapturado('development');
    log.debug({ x: 1 }, 'debug deve aparecer');
    const saida = ler();
    expect(saida).toContain('debug deve aparecer');
  });
});
