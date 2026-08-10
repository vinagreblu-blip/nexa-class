import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {
  initDb,
  registrarDeclaracao,
  buscarDeclaracao,
  marcarVerificado,
  removerDeclaracao,
  type DeclaracaoRegistrada,
} from './db';

// Cada run de testes usa um SQLite em tmp isolado — não polui o data/ do projeto.
const TMP_DB = path.join(os.tmpdir(), `nexa-test-${process.pid}-${Date.now()}.sqlite`);

function declaracaoFixture(overrides: Partial<DeclaracaoRegistrada> = {}): DeclaracaoRegistrada {
  return {
    codigo_verificacao: 'cod-123',
    hash_conteudo: 'abcsha256',
    dados_aluno: {
      nome: 'João da Silva',
      matricula: '2024001',
      curso: 'Direito',
      cpf: '12345678900',
    },
    emitido_em: '2026-08-10T15:00:00.000Z',
    verificado_em: null,
    ...overrides,
  };
}

beforeAll(async () => {
  process.env.DB_PATH = TMP_DB;
  await initDb();
});

afterAll(() => {
  // Melhor esforço: remove o SQLite temporário da sessão de testes.
  try {
    if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
  } catch {
    /* ignora */
  }
});

beforeEach(() => {
  // Limpa a tabela entre testes para garantir isolamento.
  removerDeclaracao('cod-123');
  removerDeclaracao('cod-456');
  removerDeclaracao('cod-xss');
});

describe('registrarDeclaracao + buscarDeclaracao', () => {
  it('roundtrip: registra e recupera com dados_aluno desserializado', () => {
    registrarDeclaracao(declaracaoFixture());
    const busca = buscarDeclaracao('cod-123');
    expect(busca).not.toBeNull();
    expect(busca!.dados_aluno).toEqual({
      nome: 'João da Silva',
      matricula: '2024001',
      curso: 'Direito',
      cpf: '12345678900',
    });
    expect(busca!.emitido_em).toBe('2026-08-10T15:00:00.000Z');
    expect(busca!.verificado_em).toBeNull();
  });

  it('buscarDeclaracao de código inexistente retorna null', () => {
    expect(buscarDeclaracao('nao-existe')).toBeNull();
  });

  it('INSERT OR REPLACE: re-registrar mesmo código sobrescreve', () => {
    registrarDeclaracao(declaracaoFixture());
    registrarDeclaracao(
      declaracaoFixture({
        dados_aluno: {
          nome: 'Maria Alterada',
          matricula: '2024001',
          curso: null,
          cpf: null,
        },
      })
    );
    const busca = buscarDeclaracao('cod-123');
    expect(busca!.dados_aluno.nome).toBe('Maria Alterada');
    expect(busca!.dados_aluno.curso).toBeNull();
  });

  it('trata curso e cpf nulos (persistência)', () => {
    registrarDeclaracao(
      declaracaoFixture({
        dados_aluno: { nome: 'X', matricula: 'm1', curso: null, cpf: null },
      })
    );
    const busca = buscarDeclaracao('cod-123');
    expect(busca!.dados_aluno.curso).toBeNull();
    expect(busca!.dados_aluno.cpf).toBeNull();
  });
});

describe('marcarVerificado', () => {
  it('seta verificado_em para um timestamp não-nulo', () => {
    registrarDeclaracao(declaracaoFixture());
    expect(buscarDeclaracao('cod-123')!.verificado_em).toBeNull();
    marcarVerificado('cod-123');
    const busca = buscarDeclaracao('cod-123');
    expect(busca!.verificado_em).not.toBeNull();
    expect(busca!.verificado_em!.length).toBeGreaterThan(0);
  });

  it('é idempotente (re-marcar continua setando o timestamp)', () => {
    registrarDeclaracao(declaracaoFixture());
    marcarVerificado('cod-123');
    const v1 = buscarDeclaracao('cod-123')!.verificado_em;
    marcarVerificado('cod-123');
    const v2 = buscarDeclaracao('cod-123')!.verificado_em;
    expect(v2).not.toBeNull();
    expect(v1).not.toBeNull();
  });

  it('marcar código inexistente não lança', () => {
    expect(() => marcarVerificado('nao-existe')).not.toThrow();
  });
});

describe('removerDeclaracao', () => {
  it('retorna changes=1 ao remover existente e changes=0 na segunda chamada', () => {
    registrarDeclaracao(declaracaoFixture());
    const r1 = removerDeclaracao('cod-123');
    expect(r1.changes).toBe(1);
    const r2 = removerDeclaracao('cod-123');
    expect(r2.changes).toBe(0);
  });

  it('retorna changes=0 ao remover inexistente', () => {
    expect(removerDeclaracao('nao-existe').changes).toBe(0);
  });
});
