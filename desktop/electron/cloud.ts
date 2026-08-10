import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// CONFIG EMBUTIDA — sempre ativo, sem configuração manual
// ============================================================
const SUPABASE_URL = 'https://evapmgnwznybylbtjmco.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2YXBtZ253em55YnlsYnRqbWNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MTU4MTcsImV4cCI6MjA5ODI5MTgxN30.NeljJ7Yk3fxb5ImuxJCy1oZxwCRw-2fI3jYZy-7KHnc';

let client: SupabaseClient | null = null;
let syncing = false;

export function isCloudEnabled(): boolean {
  return client !== null;
}

export function getClient(): SupabaseClient | null {
  return client;
}

export function getConfig(): { url: string; key: string; enabled: boolean } {
  return { url: SUPABASE_URL, key: SUPABASE_KEY, enabled: true };
}

export function saveConfig(): void {
  // No-op: config é embutida
}

export function initCloud(): void {
  try {
    const WebSocket = require('ws');
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      realtime: { transport: WebSocket },
    });
    console.log('[cloud] Supabase conectado (auto-config)');
  } catch (e: any) {
    console.warn('[cloud] Erro ao conectar:', e?.message);
    client = null;
  }
}

// ============================================================
// SYNC BIDIRECIONAL POR LINHA (10+ máquinas simultâneas)
// ============================================================

const TABELAS = [
  'usuarios',
  'alunos',
  'docentes',
  'disciplinas',
  'historico_disciplinas',
  'declaracoes',
  'assinaturas',
  'diplomas',
  'atas_colacao',
  'cursos_livres',
  'curso_livre_alunos',
  'aluno_documentos',
];

const BOOL_COLS = new Set(['ativo', 'enviado_web', 'convertido']);

/** Converte timestamp ISO do Supabase para formato SQLite */
function isoToSqlite(v: any): string {
  if (typeof v !== 'string') return String(v);
  if (v.includes('T')) {
    return v.replace('T', ' ').replace(/\+00:00$/, '').replace(/Z$/, '');
  }
  return v;
}

/** Converte timestamp SQLite para ISO do Supabase */
function sqliteToIso(v: any): string {
  if (typeof v !== 'string') return v;
  if (v && !v.includes('T') && v.includes(' ')) {
    return v.replace(' ', 'T') + 'Z';
  }
  return v;
}

/** Comparar timestamps (retorna >0 se a>b, <0 se a<b, 0 se igual) */
function compararTs(a: string, b: string): number {
  return new Date(sqliteToIso(a)).getTime() - new Date(sqliteToIso(b)).getTime();
}

/** Sync bidirecional completo — resolve conflitos por updated_at */
export async function syncBidirecional(getDb: () => any): Promise<void> {
  if (!client || syncing) return;
  syncing = true;

  try {
  const db = getDb();

  for (const tabela of TABELAS) {
    try {
      // Colunas existentes localmente
      const localCols = (db.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[]).map((c) => c.name);
      if (localCols.length === 0) continue;

      // 1. PULL: baixa dados da nuvem (paginação completa)
      let fromOffset = 0;
      const PAGE_SIZE = 1000;
      let hasMore = true;
      while (hasMore) {
        const { data: remoteRows, error } = await client.from(tabela).select('*').range(fromOffset, fromOffset + PAGE_SIZE - 1);
        if (error) break;
        if (!remoteRows || remoteRows.length === 0) { hasMore = false; break; }
        if (remoteRows.length < PAGE_SIZE) hasMore = false;
        fromOffset += PAGE_SIZE;

        for (const row of remoteRows) {
          try {
            const cols = Object.keys(row).filter((k) => localCols.includes(k) && row[k] !== undefined);
            const vals = cols.map((k) => {
              const v = row[k];
              if (v === null) return null;
              if (typeof v === 'boolean') return v ? 1 : 0;
              if (k === 'created_at' || k === 'updated_at' || k === 'emitido_em') return isoToSqlite(v);
              if (typeof v === 'object') return JSON.stringify(v);
              return String(v);
            });

            if (row.id != null && localCols.includes('updated_at')) {
              if (tabela === 'usuarios' && row.username === 'admin') continue;

              const local = db.prepare(`SELECT updated_at FROM ${tabela} WHERE id = ?`).get(row.id) as { updated_at?: string } | undefined;
              if (local?.updated_at) {
                const cmp = compararTs(local.updated_at, isoToSqlite(row.updated_at ?? ''));
                if (cmp >= 0) continue;
              }
            }

            const placeholders = cols.map(() => '?').join(', ');
            const updateCols = cols.filter((c) => c !== 'id');
            if (updateCols.length > 0) {
              const updateSet = updateCols.map((c) => `${c} = excluded.${c}`).join(', ');
              db.prepare(`INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateSet}`).run(...vals);
            } else {
              db.prepare(`INSERT OR IGNORE INTO ${tabela} (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
            }
          } catch { /* ignora linha com erro */ }
        }
      }

      // 2. PUSH: envia dados locais para nuvem
      const localRows = db.prepare(`SELECT * FROM ${tabela}`).all() as Record<string, any>[];
      if (localRows.length > 0) {
        const batch = localRows.map((row) => {
          const r: Record<string, any> = {};
          for (const [k, v] of Object.entries(row)) {
            if (v === undefined) continue;
            if (BOOL_COLS.has(k)) {
              r[k] = v === 1 || v === true;
            } else if (k === 'created_at' || k === 'updated_at' || k === 'emitido_em') {
              r[k] = sqliteToIso(String(v));
            } else {
              r[k] = v;
            }
          }
          return r;
        });
        // Upsert em lotes de 500 para não estourar limite do PostgREST
        for (let i = 0; i < batch.length; i += 500) {
          const chunk = batch.slice(i, i + 500);
          try {
            await client.from(tabela).upsert(chunk);
          } catch (e: any) {
            console.warn(`[cloud] Erro ao enviar ${tabela} (${i}-${i + chunk.length}):`, e?.message);
          }
        }
      }

      // 3. Atualiza autoincrement local para evitar conflito de IDs
      const maxRow = db.prepare(`SELECT MAX(id) as mx FROM ${tabela}`).get() as { mx?: number } | undefined;
      if (maxRow?.mx) {
        try {
          db.prepare(`UPDATE sqlite_sequence SET seq = ? WHERE name = ?`).run(maxRow.mx, tabela);
        } catch { /* tabela sem autoincrement */ }
      }
    } catch (e: any) {
      console.warn(`[cloud] Erro ao sincronizar ${tabela}:`, e?.message);
    }
  }
  } catch (e: any) {
    console.warn('[cloud] Erro no sync:', e?.message);
  } finally {
    syncing = false;
  }
}

/**
 * Executa `fn` segurando o mutex do sync, de forma que o sync periódico (a cada
 * 15s) não rode durante a operação. Usado para exclusões que precisam apagar o
 * registro local e remoto atomicamente — sem isso, um sync no meio da operação
 * poderia re-inserir (PULL) ou re-enviar (PUSH) o registro e ressuscitá-lo.
 */
export async function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  while (syncing) await new Promise((r) => setTimeout(r, 50));
  syncing = true;
  try {
    return await fn();
  } finally {
    syncing = false;
  }
}

// ============================================================
// SYNC DE ARQUIVOS (assinaturas, certificados)
// ============================================================

const DB_REMOTE_KEY = 'nexa-class.sqlite';

/** Envia um arquivo para a nuvem (base64 na tabela arquivos) */
export async function uploadFileToCloud(localPath: string): Promise<void> {
  if (!client || !fs.existsSync(localPath)) return;
  try {
    const buf = fs.readFileSync(localPath);
    const base64 = buf.toString('base64');
    const nome = path.basename(localPath);
    const { error } = await client.from('arquivos').upsert({
      caminho: nome,
      dados: base64,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.warn(`[cloud] Erro ao enviar ${nome}:`, error.message);
    } else {
      console.log(`[cloud] Arquivo enviado: ${nome}`);
    }
  } catch (e: any) {
    console.warn(`[cloud] Erro ao enviar ${localPath}:`, e?.message);
  }
}

/** Baixa todos os arquivos da nuvem para um diretório local */
export async function downloadAllFilesFromCloud(dir: string): Promise<void> {
  if (!client) return;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  try {
    const { data, error } = await client
      .from('arquivos')
      .select('caminho, dados')
      .neq('caminho', DB_REMOTE_KEY);

    if (error || !data) return;

    for (const row of data) {
      try {
        const safeName = path.basename(row.caminho);
        if (!safeName || safeName !== row.caminho) continue;
        const localPath = path.join(dir, safeName);
        const resolved = path.resolve(localPath);
        if (!resolved.startsWith(path.resolve(dir) + path.sep)) continue;
        const buf = Buffer.from(row.dados, 'base64');
        fs.writeFileSync(resolved, buf);
        console.log(`[cloud] Arquivo baixado: ${row.caminho}`);
      } catch { /* ignora */ }
    }
  } catch (e: any) {
    console.warn('[cloud] Erro ao baixar arquivos:', e?.message);
  }
}

// ============================================================
// Compatibilidade com código antigo
// ============================================================

export async function syncFromCloud(getDb: () => any): Promise<{ synced: number }> {
  await syncBidirecional(getDb);
  return { synced: 0 };
}

export async function pushToCloud(): Promise<void> {
  // No-op: sync é bidirecional agora
}
