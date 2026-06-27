import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import fs from 'node:fs';

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

let instance: SqlJsDatabase | null = null;
let persistFn: (() => void) | null = null;

function lastInsertRowid(): number {
  if (!instance) return 0;
  const res = instance.exec('SELECT last_insert_rowid() AS id');
  if (res.length && res[0].values.length) {
    const v = res[0].values[0][0];
    return typeof v === 'bigint' ? Number(v) : (v as number);
  }
  return 0;
}

function makeStatement(sql: string): StatementResult {
  return {
    run(...params: any[]) {
      if (!instance) throw new Error('DB não inicializado');
      try {
        instance.run(sql, params);
      } catch (e: any) {
        const msg = e?.message ? e.message : String(e);
        const err = new Error(msg);
        if (/UNIQUE constraint/i.test(msg)) (err as any).code = 'SQLITE_CONSTRAINT_UNIQUE';
        throw err;
      }
      const changes = instance.getRowsModified();
      const id = lastInsertRowid();
      persistFn?.();
      return { changes, lastInsertRowid: id };
    },
    get(...params: any[]) {
      if (!instance) throw new Error('DB não inicializado');
      const stmt = instance.prepare(sql);
      let row: any;
      if (params.length) {
        stmt.bind(params);
        if (stmt.step()) row = stmt.getAsObject();
      } else {
        if (stmt.step()) row = stmt.getAsObject();
      }
      stmt.free();
      return row;
    },
    all(...params: any[]) {
      if (!instance) throw new Error('DB não inicializado');
      const stmt = instance.prepare(sql);
      const rows: any[] = [];
      if (params.length) stmt.bind(params);
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
  };
}

export async function openDatabase(dbPath: string): Promise<DbAdapter> {
  const SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    instance = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    instance = new SQL.Database();
  }
  persistFn = () => {
    if (!instance) return;
    fs.writeFileSync(dbPath, Buffer.from(instance.export()));
  };

  instance.run('PRAGMA foreign_keys = ON');

  const adapter: DbAdapter = {
    prepare: (sql: string) => makeStatement(sql),
    exec: (sql: string) => {
      if (!instance) throw new Error('DB não inicializado');
      instance.exec(sql);
      persistFn?.();
    },
    pragma: (_s: string) => {
      /* no-op: sql.js roda em memória (WASM) */
    },
  };

  return adapter;
}

export function saveNow(): void {
  persistFn?.();
}
