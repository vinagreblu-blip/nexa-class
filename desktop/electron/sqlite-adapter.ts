import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import fs from 'node:fs';
import { logger } from './utils/logger';

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

// ============================================================
// Notificação de escritas LOCAIS (para push acelerado da nuvem)
// ============================================================
// O sync em tempo real precisa empurrar mudanças para o Supabase logo após
// uma mutação do usuário (~3s), em vez de esperar o ciclo de 15s. Para isso,
// o adapter avisa um listener a cada escrita — exceto escritas que aplicam
// dados vindos da nuvem (pull/realtime), marcadas via flag de supressão
// (senão cada pull dispararia um push em loop).

type LocalWriteListener = () => void;
let localWriteListener: LocalWriteListener | null = null;
let suppressLocalWriteNotify = false;

export function setLocalWriteListener(fn: LocalWriteListener | null): void {
  localWriteListener = fn;
}

export function setSuppressLocalWriteNotify(v: boolean): void {
  suppressLocalWriteNotify = v;
}

function notifyLocalWrite(): void {
  if (suppressLocalWriteNotify || !localWriteListener) return;
  try {
    localWriteListener();
  } catch (e: any) {
    logger.warn({ err: e }, 'Listener de escrita local falhou');
  }
}

/**
 * Persiste o DB em disco de forma ATÔMICA:
 *   1. Escreve o conteúdo em arquivo temporário <path>.tmp
 *   2. Renomeia <path>.tmp -> <path> (rename é atômico no mesmo filesystem)
 * Isso evita corrupção em queda de energia / kill do processo mid-write.
 * Não usa mais writeFileSync direto sobre o arquivo de dados.
 *
 * No Windows, rename pode falhar com EPERM/EBUSY/ENOTEMPTY se o destino estiver
 * aberto por outro processo (antivírus, indexador, backup). Fazemos retry com
 * backoff exponencial antes de desistir.
 */
function persistAtomicSync(): void {
  if (!instance || !dbPathActive) return;
  const tmp = `${dbPathActive}.tmp`;
  const data = Buffer.from(instance.export());
  try {
    fs.writeFileSync(tmp, data);
    renameWithRetry(tmp, dbPathActive);
  } catch (e: any) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* ignora */
    }
    logger.error({ err: e }, 'Falha ao persistir banco');
    throw e;
  }
}

const RENAME_ERRORS = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES', 'EBUSY']);
const RENAME_MAX_RETRIES = 5;
const RENAME_BASE_DELAY_MS = 20;

function renameWithRetry(src: string, dest: string): void {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RENAME_MAX_RETRIES; attempt++) {
    try {
      fs.renameSync(src, dest);
      return;
    } catch (e: any) {
      lastErr = e;
      const code = e?.code as string | undefined;
      if (!code || !RENAME_ERRORS.has(code)) {
        // Erro não-transiente — não adianta tentar de novo
        throw e;
      }
      // Backoff exponencial com jitter: 20ms, 40ms, 80ms, 160ms, 320ms
      const delay = RENAME_BASE_DELAY_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 10);
      // Sleep síncrono (rotina rara — manter simples)
      const end = Date.now() + delay;
      while (Date.now() < end) {
        /* busy-wait curto */
      }
    }
  }
  throw lastErr;
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
        logger.error({ err: e }, 'persist debounced falhou');
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
      notifyLocalWrite();
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
      notifyLocalWrite();
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

