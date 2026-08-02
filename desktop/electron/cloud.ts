import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { app } from 'electron';
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
  'cursos_livres',
];

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

  const db = getDb();

  for (const tabela of TABELAS) {
    try {
      // Colunas existentes localmente
      const localCols = (db.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[]).map((c) => c.name);
      if (localCols.length === 0) continue;

      // 1. PULL: baixa dados da nuvem
      const { data: remoteRows, error } = await client.from(tabela).select('*').limit(10000);
      if (!error && remoteRows) {
        for (const row of remoteRows) {
          try {
            // Filtra colunas que existem localmente
            const cols = Object.keys(row).filter((k) => localCols.includes(k) && row[k] !== null && row[k] !== undefined);
            const vals = cols.map((k) => {
              const v = row[k];
              if (typeof v === 'boolean') return v ? 1 : 0;
              if (k === 'created_at' || k === 'updated_at' || k === 'emitido_em') return isoToSqlite(v);
              if (typeof v === 'object') return JSON.stringify(v);
              return String(v);
            });

            // Verifica conflito: só sobrescreve se remoto for mais recente
            if (row.id != null && localCols.includes('updated_at')) {
              const local = db.prepare(`SELECT updated_at FROM ${tabela} WHERE id = ?`).get(row.id) as { updated_at?: string } | undefined;
              if (local?.updated_at) {
                const cmp = compararTs(local.updated_at, isoToSqlite(row.updated_at));
                if (cmp >= 0) continue; // local é mais novo ou igual — não sobrescreve
              }
            }

            const placeholders = cols.map(() => '?').join(', ');
            db.prepare(`INSERT OR REPLACE INTO ${tabela} (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
          } catch { /* ignora linha com erro */ }
        }
      }

      // 2. PUSH: envia dados locais para nuvem
      const localRows = db.prepare(`SELECT * FROM ${tabela}`).all() as Record<string, any>[];
      if (localRows.length > 0) {
        const batch = localRows.map((row) => {
          const r: Record<string, any> = {};
          for (const [k, v] of Object.entries(row)) {
            if (v === null || v === undefined) continue;
            if (k === 'created_at' || k === 'updated_at' || k === 'emitido_em') {
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

  syncing = false;
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
        const localPath = path.join(dir, row.caminho);
        const buf = Buffer.from(row.dados, 'base64');
        fs.writeFileSync(localPath, buf);
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
