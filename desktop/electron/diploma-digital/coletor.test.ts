import { beforeEach, describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { coletarSnapshot, type AdapterDb } from './coletor';

// ============================================================
// REGRESSÃO (v1.4.3): o match de curso do coletor era um SQL com 24
// REPLACE( aninhados e parênteses errados — `prepare` falhava com
// "syntax error near LIMIT" no SQLite REAL, derrubando coletarSnapshot
// (e portanto a geração do XML) para qualquer aluno. Os testes com DB
// fake não executavam esse SQL e nunca pegaram. Aqui o snapshot roda
// contra SQLite de verdade (sql.js + adapter igual ao do app).
// ============================================================

function wrap(db: any): AdapterDb {
  return {
    prepare(sql: string) {
      return {
        get: (...params: any[]) => {
          const stmt = db.prepare(sql);
          if (params.length) stmt.bind(params);
          const row = stmt.step() ? stmt.getAsObject() : undefined;
          stmt.free();
          return row;
        },
        all: (...params: any[]) => {
          const stmt = db.prepare(sql);
          if (params.length) stmt.bind(params);
          const rows: any[] = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          stmt.free();
          return rows;
        },
      };
    },
  } as AdapterDb;
}

let db: any;

beforeEach(async () => {
  const SQL = await initSqlJs();
  db = new SQL.Database();
  db.exec(`
    CREATE TABLE alunos (id INTEGER PRIMARY KEY, nome TEXT, curso TEXT);
    CREATE TABLE ies (id INTEGER PRIMARY KEY, nome TEXT, papel TEXT, ativo INTEGER DEFAULT 1);
    CREATE TABLE cursos (id INTEGER PRIMARY KEY, ies_id INTEGER, nome TEXT, ativo INTEGER DEFAULT 1);
    CREATE TABLE historico_disciplinas (id INTEGER PRIMARY KEY, aluno_id INTEGER, periodo TEXT, disciplina TEXT, ordem INTEGER DEFAULT 0);
    CREATE TABLE diplomas_digitais (id INTEGER PRIMARY KEY, aluno_id INTEGER, ies_emissora_id INTEGER, status TEXT);
    INSERT INTO ies (id, nome, papel) VALUES (1, 'IES X', 'emissora');
    INSERT INTO cursos (id, ies_id, nome) VALUES
      (1, 1, 'ADMINISTRAÇÃO'),
      (2, 1, 'Sistema de Informação'),
      (3, 1, 'Curso Desativado');
    UPDATE cursos SET ativo = 0 WHERE id = 3;
    INSERT INTO alunos (id, nome, curso) VALUES
      (10, 'Maria', 'ADMINISTRACAO'),
      (11, 'João', 'sistema de informação'),
      (12, 'Ana', 'Curso Desativado');
    INSERT INTO historico_disciplinas (id, aluno_id, periodo, disciplina, ordem) VALUES (1, 10, '1', 'Cálculo', 1);
    INSERT INTO diplomas_digitais (id, aluno_id, ies_emissora_id, status) VALUES
      (100, 10, 1, 'apto'), (101, 11, 1, 'apto'), (102, 12, 1, 'apto');
  `);
});

describe('coletarSnapshot — match de curso com SQL real (regressão do REPLACE quebrado)', () => {
  it('snapshot NÃO lança erro de sintaxe (o SQL antigo quebrava no prepare)', () => {
    expect(() => coletarSnapshot(wrap(db), 100)).not.toThrow();
  });

  it('casa nome do aluno sem acento com curso acentuado', () => {
    const s = coletarSnapshot(wrap(db), 100);
    expect(s?.curso?.id).toBe(1);
    expect(s?.curso?.nome).toBe('ADMINISTRAÇÃO');
  });

  it('casa ignorando caixa e acentos', () => {
    const s = coletarSnapshot(wrap(db), 101);
    expect(s?.curso?.id).toBe(2);
  });

  it('curso inativo não casa (snapshot volta sem curso — vira pendência)', () => {
    const s = coletarSnapshot(wrap(db), 102);
    expect(s?.curso).toBeUndefined();
  });

  it('carrega aluno, IES emissora e disciplinas', () => {
    const s = coletarSnapshot(wrap(db), 100);
    expect(s?.aluno?.nome).toBe('Maria');
    expect(s?.ies?.nome).toBe('IES X');
    expect(s?.disciplinas).toHaveLength(1);
  });

  it('processo inexistente → null', () => {
    expect(coletarSnapshot(wrap(db), 9999)).toBeNull();
  });
});
