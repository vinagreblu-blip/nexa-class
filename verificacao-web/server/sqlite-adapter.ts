import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Adapter SQLite nativo (better-sqlite3) para o serviço de verificação web.
 *
 * Substitui o sql.js (WASM) anterior. Mantém a mesma interface `DbAdapter`
 * para que `db.ts` não precise mudar — drop-in replacement.
 *
 * Diferenciais vs sql.js:
 *  - Nativo (compilado C++) — sem WASM, sem carregar DB inteiro em memória
 *  - Persistência transparente via mmap (não reescreve arquivo a cada op)
 *  - Síncrono — combina com o modelo single-thread do Node
 *
 * Trade-off: adiciona dep de build nativa (prebuilt binary para win/linux/mac).
 */

export interface StatementResult {
  run: (...params: any[]) => { changes: number; lastInsertRowid: number | bigint };
  get: (...params: any[]) => any;
  all: (...params: any[]) => any[];
}

export interface DbAdapter {
  prepare: (sql: string) => StatementResult;
  exec: (sql: string) => void;
  pragma: (s: string) => void;
}

let instance: Database.Database | null = null;

function makeStatement(sql: string): StatementResult {
  // Statement é criado lazy na primeira chamada — better-sqlite3 cacheia internamente.
  let stmt: Database.Statement | null = null;
  const getStmt = (): Database.Statement => {
    if (!instance) throw new Error('DB não inicializado');
    if (!stmt) stmt = instance.prepare(sql);
    return stmt;
  };

  return {
    run(...params: any[]) {
      if (!instance) throw new Error('DB não inicializado');
      try {
        const result = getStmt().run(...params);
        return {
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid as number | bigint,
        };
      } catch (e: any) {
        const msg = e?.message ? e.message : String(e);
        const err = new Error(msg);
        // better-sqlite3 usa códigos como SQLITE_CONSTRAINT_UNIQUE diretamente em e.code
        if (e?.code) (err as any).code = e.code;
        else if (/UNIQUE constraint/i.test(msg)) (err as any).code = 'SQLITE_CONSTRAINT_UNIQUE';
        throw err;
      }
    },
    get(...params: any[]) {
      if (!instance) throw new Error('DB não inicializado');
      return getStmt().get(...params);
    },
    all(...params: any[]) {
      if (!instance) throw new Error('DB não inicializado');
      return getStmt().all(...params);
    },
  };
}

export function openDatabase(dbPath: string): DbAdapter {
  // Garante que o diretório pai existe — melhor-sqlite3 falha silenciosamente
  // se o path não for gravável.
  const dir = dbPath.substring(0, dbPath.lastIndexOf(path.sep));
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  instance = new Database(dbPath);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');

  const adapter: DbAdapter = {
    prepare: (sql: string) => makeStatement(sql),
    exec: (sql: string) => {
      if (!instance) throw new Error('DB não inicializado');
      instance.exec(sql);
    },
    pragma: (s: string) => {
      if (!instance) return;
      instance.pragma(s);
    },
  };

  return adapter;
}

/** Fecha o DB — usado apenas em shutdown/testes para liberar o handle. */
export function closeDatabase(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
