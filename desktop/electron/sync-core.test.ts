import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import initSqlJs from 'sql.js';
import {
  TABELAS_SINCRONIZADAS,
  aplicarDeleteRemoto,
  aplicarLinhaRemota,
  aplicarTombstonesRemotos,
  agoraSqlite,
  compararTs,
  instalarInfraSincronizacao,
  isoToSqlite,
  linhaParaRemoto,
  linhasParaPush,
  lerWatermarkPush,
  salvarWatermarkPush,
  sqliteToIso,
  type TombstoneRemoto,
} from './sync-core';

// ============================================================
// Testes do núcleo de sincronização multiusuário.
// Simula duas máquinas (dois SQLite independentes) trocando linhas
// no formato do Supabase (ISO timestamps, booleans) — exatamente o
// caminho percorrido pelo pull/push e pelos eventos realtime.
// (sqlite-adapter depende do Electron — aqui usamos sql.js puro com
//  um mini-adapter equivalente.)
// ============================================================

interface MiniAdapter {
  prepare: (sql: string) => {
    run: (...p: any[]) => { changes: number };
    get: (...p: any[]) => any;
    all: (...p: any[]) => any[];
  };
  exec: (sql: string) => void;
}

function wrap(db: any): MiniAdapter {
  return {
    prepare(sql: string) {
      return {
        run: (...params: any[]) => {
          db.run(sql, params);
          return { changes: db.getRowsModified() };
        },
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
    exec: (sql: string) => db.exec(sql),
  };
}

let tmpDir: string;
let dbA: MiniAdapter;
let dbB: MiniAdapter;

/** Cria um "banco de máquina" com o schema mínimo das tabelas usadas nos testes. */
async function criarBanco(): Promise<MiniAdapter> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  const adapter = wrap(db);
  adapter.exec(`
    CREATE TABLE alunos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matricula TEXT UNIQUE NOT NULL,
      nome TEXT NOT NULL,
      curso TEXT,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE configuracoes (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
  `);
  instalarInfraSincronizacao(adapter, TABELAS_SINCRONIZADAS);
  return adapter;
}

/** Insere um aluno local (como um handler IPC faria). */
function inserirAlunoLocal(db: MiniAdapter, id: number, nome: string, matricula: string): void {
  db.prepare(
    "INSERT INTO alunos (id, matricula, nome, updated_at) VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))"
  ).run(id, matricula, nome);
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-sync-test-'));
  dbA = await criarBanco();
  dbB = await criarBanco();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('conversão de timestamps', () => {
  it('ISO → SQLite e volta', () => {
    expect(isoToSqlite('2026-08-25T10:00:00.000Z')).toBe('2026-08-25 10:00:00.000');
    expect(isoToSqlite('2026-08-25T10:00:00+00:00')).toBe('2026-08-25 10:00:00');
    expect(sqliteToIso('2026-08-25 10:00:00')).toBe('2026-08-25T10:00:00Z');
    expect(sqliteToIso('2026-08-25 10:00:00.123')).toBe('2026-08-25T10:00:00.123Z');
  });

  it('compararTs ordena corretamente nos dois formatos', () => {
    expect(compararTs('2026-08-25 10:00:00', '2026-08-25T10:00:01Z')).toBeLessThan(0);
    expect(compararTs('2026-08-25 10:00:01', '2026-08-25T10:00:00Z')).toBeGreaterThan(0);
    expect(compararTs('2026-08-25 10:00:00', '2026-08-25T10:00:00Z')).toBe(0);
  });
});

describe('aplicarLinhaRemota (INSERT/UPDATE vindo da nuvem)', () => {
  it('insere linha nova e reporta mudança', () => {
    const mudou = aplicarLinhaRemota(dbA, 'alunos', {
      id: 1,
      matricula: '202612345',
      nome: 'Aluno João',
      curso: 'Administração',
      ativo: true,
      created_at: '2026-08-25T10:00:00.000Z',
      updated_at: '2026-08-25T10:00:00.000Z',
    });
    expect(mudou).toBe(true);
    const row = dbA.prepare('SELECT * FROM alunos WHERE id = 1').get() as any;
    expect(row.nome).toBe('Aluno João');
    expect(row.ativo).toBe(1); // boolean → integer
    expect(row.updated_at).toBe('2026-08-25 10:00:00.000'); // ISO → SQLite
  });

  it('aplica UPDATE remoto mais novo', () => {
    aplicarLinhaRemota(dbA, 'alunos', {
      id: 1, matricula: 'm1', nome: 'Antigo', updated_at: '2026-08-25T10:00:00.000Z',
    });
    const mudou = aplicarLinhaRemota(dbA, 'alunos', {
      id: 1, matricula: 'm1', nome: 'Editado pelo Usuário 3', updated_at: '2026-08-25T11:00:00.000Z',
    });
    expect(mudou).toBe(true);
    expect((dbA.prepare('SELECT nome FROM alunos WHERE id = 1').get() as any).nome).toBe(
      'Editado pelo Usuário 3'
    );
  });

  it('ignora linha remota mais antiga (proteção contra sobrescrita)', () => {
    aplicarLinhaRemota(dbA, 'alunos', {
      id: 1, matricula: 'm1', nome: 'Edição local nova', updated_at: '2026-08-25T12:00:00.000Z',
    });
    const mudou = aplicarLinhaRemota(dbA, 'alunos', {
      id: 1, matricula: 'm1', nome: 'Stale antigo', updated_at: '2026-08-25T11:00:00.000Z',
    });
    expect(mudou).toBe(false);
    expect((dbA.prepare('SELECT nome FROM alunos WHERE id = 1').get() as any).nome).toBe(
      'Edição local nova'
    );
  });

  it('ignora eco do próprio push (mesmo timestamp)', () => {
    aplicarLinhaRemota(dbA, 'alunos', {
      id: 1, matricula: 'm1', nome: 'X', updated_at: '2026-08-25T10:00:00.000Z',
    });
    // mesma linha voltando pelo realtime após o próprio push
    const mudou = aplicarLinhaRemota(dbA, 'alunos', {
      id: 1, matricula: 'm1', nome: 'X', updated_at: '2026-08-25T10:00:00.000Z',
    });
    expect(mudou).toBe(false);
  });

  it('nunca sobrescreve o usuário admin local', () => {
    const mudou = aplicarLinhaRemota(dbA, 'usuarios', {
      id: 1, username: 'admin', nome: 'Intruso', updated_at: '2099-01-01T00:00:00.000Z',
    });
    expect(mudou).toBe(false);
  });

  it('bloqueia linha stale de um registro já excluído (anti-ressurreição)', () => {
    // Máquina A excluiu o aluno 1 localmente → tombstone existe
    inserirAlunoLocal(dbA, 1, 'Aluno João', 'm1');
    dbA.prepare('DELETE FROM alunos WHERE id = 1').run();
    // Outra máquina (que ainda não sabia da exclusão) re-enviou a linha antiga
    const mudou = aplicarLinhaRemota(dbA, 'alunos', {
      id: 1, matricula: 'm1', nome: 'Aluno João (stale)', updated_at: '2020-01-01T00:00:00.000Z',
    });
    expect(mudou).toBe(false);
    expect(dbA.prepare('SELECT COUNT(*) as n FROM alunos').get()).toEqual({ n: 0 });
  });

  it('permite re-criação legítima (updated_at mais novo que o tombstone)', () => {
    inserirAlunoLocal(dbA, 1, 'Aluno João', 'm1');
    dbA.prepare('DELETE FROM alunos WHERE id = 1').run();
    // Re-cadastro com timestamp novo → deve passar
    const mudou = aplicarLinhaRemota(dbA, 'alunos', {
      id: 1, matricula: 'm1', nome: 'Aluno João (re-criado)', updated_at: '2099-01-01T00:00:00.000Z',
    });
    expect(mudou).toBe(true);
    expect(dbA.prepare('SELECT COUNT(*) as n FROM alunos').get()).toEqual({ n: 1 });
  });
});

describe('triggers locais (tombstones + bump de updated_at)', () => {
  it('DELETE local grava tombstone', () => {
    inserirAlunoLocal(dbA, 7, 'Aluno', 'm7');
    dbA.prepare('DELETE FROM alunos WHERE id = 7').run();
    const tomb = dbA
      .prepare('SELECT tabela, id FROM delecoes WHERE tabela = ? AND id = ?')
      .get('alunos', 7) as any;
    expect(tomb).toBeTruthy();
  });

  it('UPDATE local sem tocar updated_at recebe bump automático', () => {
    // timestamp antigo e explícito → determinístico (não depende de o insert
    // e o update caírem no mesmo milissegundo)
    dbA.prepare(
      "INSERT INTO alunos (id, matricula, nome, updated_at) VALUES (8, 'm8', 'Nome Antigo', '2020-01-01 00:00:00.000')"
    ).run();
    dbA.prepare("UPDATE alunos SET nome = 'Nome Novo' WHERE id = 8").run();
    const depois = (dbA.prepare('SELECT updated_at FROM alunos WHERE id = 8').get() as any).updated_at;
    expect(compararTs(depois, '2020-01-01 00:00:00.000')).toBeGreaterThan(0);
    expect((dbA.prepare('SELECT nome FROM alunos WHERE id = 8').get() as any).nome).toBe('Nome Novo');
  });

  it('aplicação de linha remota NÃO leva bump (preserva timestamp da nuvem)', () => {
    aplicarLinhaRemota(dbA, 'alunos', {
      id: 9, matricula: 'm9', nome: 'V1', updated_at: '2026-08-25T10:00:00.000Z',
    });
    const ts = (dbA.prepare('SELECT updated_at FROM alunos WHERE id = 9').get() as any).updated_at;
    expect(ts).toBe('2026-08-25 10:00:00.000');
  });
});

describe('tombstones remotos (aplicarTombstonesRemotos)', () => {
  it('remove a linha local correspondente', () => {
    aplicarLinhaRemota(dbB, 'alunos', {
      id: 5, matricula: 'm5', nome: 'Aluno Maria', updated_at: '2026-08-25T10:00:00.000Z',
    });
    const alteradas = aplicarTombstonesRemotos(dbB, [
      { tabela: 'alunos', id: 5, deleted_at: '2026-08-25T11:00:00.000Z' },
    ] as TombstoneRemoto[]);
    expect(alteradas.has('alunos')).toBe(true);
    expect(dbB.prepare('SELECT COUNT(*) as n FROM alunos').get()).toEqual({ n: 0 });
  });

  it('edição local mais nova que a exclusão vence (LWW)', () => {
    aplicarLinhaRemota(dbB, 'alunos', {
      id: 5, matricula: 'm5', nome: 'Aluno Maria', updated_at: '2026-08-25T12:00:00.000Z',
    });
    const alteradas = aplicarTombstonesRemotos(dbB, [
      { tabela: 'alunos', id: 5, deleted_at: '2026-08-25T11:00:00.000Z' }, // exclusão mais antiga
    ] as TombstoneRemoto[]);
    expect(alteradas.size).toBe(0);
    expect(dbB.prepare('SELECT COUNT(*) as n FROM alunos').get()).toEqual({ n: 1 });
  });
});

describe('aplicarDeleteRemoto (evento realtime DELETE)', () => {
  it('remove a linha', () => {
    inserirAlunoLocal(dbA, 3, 'Aluno', 'm3');
    expect(aplicarDeleteRemoto(dbA, 'alunos', 3)).toBe(true);
    expect(dbA.prepare('SELECT COUNT(*) as n FROM alunos').get()).toEqual({ n: 0 });
  });

  it('no-op se já foi removida (eco)', () => {
    expect(aplicarDeleteRemoto(dbA, 'alunos', 999)).toBe(false);
  });
});

describe('push incremental (watermark)', () => {
  it('primeiro push envia tudo; o segundo só o que mudou', () => {
    inserirAlunoLocal(dbA, 1, 'Aluno A', 'ma');
    inserirAlunoLocal(dbA, 2, 'Aluno B', 'mb');

    const wm1 = lerWatermarkPush(dbA, 'alunos');
    expect(wm1).toBeNull();
    const lote1 = linhasParaPush(dbA, 'alunos', wm1);
    expect(lote1).toHaveLength(2);
    salvarWatermarkPush(dbA, 'alunos', agoraSqlite());

    // Nada mudou → próximo push vazio
    const lote2 = linhasParaPush(dbA, 'alunos', lerWatermarkPush(dbA, 'alunos'));
    expect(lote2).toHaveLength(0);

    // Edição local → só a linha editada entra no push
    dbA.prepare("UPDATE alunos SET nome = 'Aluno A (editado)' WHERE id = 1").run();
    const lote3 = linhasParaPush(dbA, 'alunos', lerWatermarkPush(dbA, 'alunos'));
    expect(lote3).toHaveLength(1);
    expect((lote3[0] as any).nome).toBe('Aluno A (editado)');
  });

  it('linhaParaRemoto converte boolean e timestamp', () => {
    const remoto = linhaParaRemoto({
      id: 1, matricula: 'ma', nome: 'A', ativo: 1, updated_at: '2026-08-25 10:00:00',
    });
    expect(remoto.ativo).toBe(true);
    expect(remoto.updated_at).toBe('2026-08-25T10:00:00Z');
  });
});

// ============================================================
// CENÁRIO OBRIGATÓRIO ( João / Maria ) — duas máquinas
// ============================================================
// U1 cadastra João → U2 vê. U3 edita → U1/U2 veem. U5 cadastra Maria →
// todos veem. U2 exclui Maria → todos veem a exclusão. Sem F5 = sem
// re-fetch manual: cada "recebimento" aqui é o evento realtime/pull
// aplicando a linha — o caminho real do código de produção.
describe('cenário multiusuário: Aluno João e Aluno Maria', () => {
  const pushDe = (de: MiniAdapter): Array<Record<string, any>> =>
    linhasParaPush(de, 'alunos', lerWatermarkPush(de, 'alunos')).map(linhaParaRemoto);

  it('cadastro, edição, segundo cadastro e exclusão propagam entre máquinas', () => {
    // --- U1 cadastra "Aluno João" na máquina A ---
    inserirAlunoLocal(dbA, 1, 'Aluno João', '2026joao');

    // Push de A → "Supabase" (lote) → Realtime entrega à máquina B
    const loteJoao = pushDe(dbA);
    salvarWatermarkPush(dbA, 'alunos', agoraSqlite());
    for (const row of loteJoao) aplicarLinhaRemota(dbB, 'alunos', row);

    // U2..U5 veem "Aluno João" sem atualizar nada manualmente
    const emB = dbB.prepare("SELECT nome FROM alunos WHERE matricula = '2026joao'").get() as any;
    expect(emB.nome).toBe('Aluno João');

    // --- U3 (máquina B) edita "Aluno João" ---
    dbB.prepare("UPDATE alunos SET nome = 'Aluno João Silva' WHERE id = 1").run();
    const loteEdicao = pushDe(dbB);
    salvarWatermarkPush(dbB, 'alunos', agoraSqlite());
    for (const row of loteEdicao) aplicarLinhaRemota(dbA, 'alunos', row);

    // U1 (máquina A) recebe a edição automaticamente
    const emA = dbA.prepare("SELECT nome FROM alunos WHERE matricula = '2026joao'").get() as any;
    expect(emA.nome).toBe('Aluno João Silva');

    // --- U5 (máquina B) cadastra "Aluno Maria" ---
    inserirAlunoLocal(dbB, 2, 'Aluno Maria', '2026maria');
    const loteMaria = pushDe(dbB);
    // (watermark de B NÃO avança — simula push preparado antes da exclusão abaixo)
    for (const row of loteMaria) aplicarLinhaRemota(dbA, 'alunos', row);

    // U1..U4 (máquina A) recebem o novo cadastro
    expect(dbA.prepare("SELECT COUNT(*) as n FROM alunos WHERE matricula = '2026maria'").get()).toEqual({ n: 1 });

    // --- U2 (máquina A) exclui "Aluno Maria" → tombstone + delete remoto ---
    dbA.prepare("DELETE FROM alunos WHERE id = 2").run();
    const tombstones = dbA
      .prepare("SELECT tabela, id, deleted_at FROM delecoes WHERE tabela = 'alunos' AND id = 2")
      .all() as TombstoneRemoto[];

    // B ainda tinha Maria: um push preparado ANTES de receber a exclusão
    // (reordenação de rede) — não pode ressuscitar o registro em A.
    const pushStaleDeB = pushDe(dbB).filter((r) => Number(r.id) === 2);
    expect(pushStaleDeB).toHaveLength(1);

    // Realtime entrega o DELETE à máquina B
    for (const t of tombstones) aplicarTombstonesRemotos(dbB, [t]);
    expect(dbB.prepare("SELECT COUNT(*) as n FROM alunos WHERE matricula = '2026maria'").get()).toEqual({ n: 0 });

    // O push stale chega depois em A → bloqueado pelo tombstone local
    for (const row of pushStaleDeB) aplicarLinhaRemota(dbA, 'alunos', row);
    expect(dbA.prepare("SELECT COUNT(*) as n FROM alunos WHERE matricula = '2026maria'").get()).toEqual({ n: 0 });
  });
});
