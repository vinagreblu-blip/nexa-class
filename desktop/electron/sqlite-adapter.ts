import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';

export interface StatementResult {
  run: (...params: any[]) => { changes: number; lastInsertRowid: number | bigint };
  get: (...params: any[]) => any;
  all: (...params: any[]) => any[];
}

export interface DbAdapter {
  prepare: (sql: string) => StatementResult;
  exec: (sql: string) => void;
  pragma: (s: string) => void;
  /**
   * Executa fn dentro de uma transação. Em caso de throw, faz ROLLBACK e relança.
   * Em sql.js isso é crucial: cada `.run()` reescreve o arquivo inteiro, então
   * um burst de INSERTs sem transação é lento E não-atômico (falha parcial deixa
   * dados órfãos). Com BEGIN/COMMIT, sql.js persiste só uma vez no fim.
   */
  transaction: <T>(fn: () => T) => T;
}

let instance: SqlJsDatabase | null = null;
let dbPathActive: string | null = null;
let persistTimer: NodeJS.Timeout | null = null;
let persistDirty = false;
let persistSync = false; // flag que força persist síncrono (ex: shutdown)

const PERSIST_DEBOUNCE_MS = 100;

/**
 * Persiste o DB em disco de forma ATÔMICA:
 *   1. Escreve o conteúdo em arquivo temporário <path>.tmp
 *   2. Renomeia <path>.tmp -> <path> (rename é atômico no mesmo filesystem)
 * Isso evita corrupção em queda de energia / kill do processo mid-write.
 * Não usa mais writeFileSync direto sobre o arquivo de dados.
 */
function persistAtomicSync(): void {
  if (!instance || !dbPathActive) return;
  const tmp = `${dbPathActive}.tmp`;
  const data = Buffer.from(instance.export());
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, dbPathActive);
  } catch (e: any) {
    // Tenta limpar o tmp em caso de falha
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignora */ }
    console.error('[sqlite-adapter] Falha ao persistir banco:', e?.message);
    throw e;
  }
}

/**
 * Marca o DB como "sujo" e agenda persistência debounced.
 * Múltiplas escritas dentro de PERSIST_DEBOUNCE_MS viram um único write no disco.
 * Reduz I/O em ciclos de seed/sync que fazem centenas de INSERTs.
 */
function schedulePersist(): void {
  persistDirty = true;
  if (persistSync) {
    // Modo shutdown: escreve imediatamente
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    persistAtomicSync();
    persistDirty = false;
    return;
  }
  if (persistTimer) return; // já agendado
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (persistDirty) {
      persistDirty = false;
      try {
        persistAtomicSync();
      } catch (e: any) {
        console.error('[sqlite-adapter] persist debounced falhou:', e?.message);
      }
    }
  }, PERSIST_DEBOUNCE_MS);
}

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
      schedulePersist();
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
  dbPathActive = dbPath;
  if (fs.existsSync(dbPath)) {
    instance = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    instance = new SQL.Database();
  }

  instance.run('PRAGMA foreign_keys = ON');

  // No encerramento do processo, garante flush síncrono
  const flushShutdown = () => {
    persistSync = true;
    if (persistDirty) {
      try { persistAtomicSync(); persistDirty = false; } catch { /* ignora */ }
    }
  };
  process.on('beforeExit', flushShutdown);
  process.on('exit', flushShutdown);

  const adapter: DbAdapter = {
    prepare: (sql: string) => makeStatement(sql),
    exec: (sql: string) => {
      if (!instance) throw new Error('DB não inicializado');
      instance.exec(sql);
      schedulePersist();
    },
    pragma: (_s: string) => {
      /* no-op: sql.js roda em memória (WASM) */
    },
    transaction: <T>(fn: () => T): T => {
      if (!instance) throw new Error('DB não inicializado');
      instance.run('BEGIN');
      try {
        const result = fn();
        instance.run('COMMIT');
        // Persiste uma única vez ao final da transação (em vez de a cada statement).
        schedulePersist();
        return result;
      } catch (e) {
        try { instance.run('ROLLBACK'); } catch { /* ignora rollback falho */ }
        throw e;
      }
    },
  };

  return adapter;
}

export function saveNow(): void {
  // Força persistência imediata (ignora debounce)
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  if (persistDirty) {
    persistDirty = false;
    persistAtomicSync();
  } else {
    // mesmo sem flag dirty, garante snapshot atual
    persistAtomicSync();
  }
}

// Cleanup no encerramento do app Electron
export function shutdown(): void {
  persistSync = true;
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  if (persistDirty) {
    try { persistAtomicSync(); } catch { /* ignora */ }
    persistDirty = false;
  }
}

