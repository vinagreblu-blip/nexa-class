import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { app } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from './utils/logger';

// ============================================================
// CONFIG EMBUTIDA — sempre ativo, sem configuração manual.
// A anon key é PÚBLICA por design (Supabase); a proteção real dos
// dados vem do RLS exigir a role `authenticated` (ver supabase-rls-auth.sql).
// Cada instalação do desktop cria sua própria identidade Supabase Auth
// (random email/sena salvos em userData/cloud-auth.json) e usa o JWT
// para acessar os dados. A anon key sozinha não serve para nada.
// ============================================================
const SUPABASE_URL = 'https://evapmgnwznybylbtjmco.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2YXBtZ253em55YnlsYnRqbWNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MTU4MTcsImV4cCI6MjA5ODI5MTgxN30.NeljJ7Yk3fxb5ImuxJCy1oZxwCRw-2fI3jYZy-7KHnc';

let client: SupabaseClient | null = null;
let syncing = false;

// Status do último sync bidirecional — lido pelo Dashboard.
// `ultimoSyncEm` = ISO timestamp; `ultimoSyncOk` = true se foi bem-sucedido.
let ultimoSyncEm: string | null = null;
let ultimoSyncOk: boolean | null = null;

// ============================================================
// AUTENTICAÇÃO POR INSTALAÇÃO
// ============================================================
export interface CloudAuthStatus {
  autenticado: boolean;
  identityEmail: string | null;
  machineId: string | null;
  ultimoErro: string | null;
  revogada: boolean;
}

const authStatus: CloudAuthStatus = {
  autenticado: false,
  identityEmail: null,
  machineId: null,
  ultimoErro: null,
  revogada: false,
};

const AUTH_FILENAME = 'cloud-auth.json';

interface IdentityFile {
  email: string;
  password: string;
  machineId: string;
}

function authFilePath(): string {
  return path.join(app.getPath('userData'), AUTH_FILENAME);
}

function generateIdentity(): IdentityFile {
  const id = randomUUID().replace(/-/g, '').slice(0, 16);
  return {
    email: `mch-${id}@nexa-class.local`,
    password: randomBytes(24).toString('base64url'),
    machineId: `mch-${id}`,
  };
}

function loadIdentity(): IdentityFile | null {
  try {
    const p = authFilePath();
    if (!fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (data && data.email && data.password && data.machineId) return data as IdentityFile;
    return null;
  } catch {
    return null;
  }
}

function saveIdentity(id: IdentityFile): void {
  try {
    const p = authFilePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(id, null, 2), { mode: 0o600 });
  } catch (e: any) {
    logger.warn({ err: e }, 'Falha ao persistir identidade de nuvem');
  }
}

/** Cria identidade Supabase Auth na primeira execução; reusa a existida depois. */
async function ensureIdentity(): Promise<IdentityFile | null> {
  const existing = loadIdentity();
  if (existing) return existing;
  if (!client) return null;
  const fresh = generateIdentity();
  const { error } = await client.auth.signUp(fresh);
  if (error) {
    authStatus.ultimoErro = `Cadastro falhou: ${error.message}`;
    logger.warn({ err: error.message }, 'Falha ao criar identidade Supabase');
    return null;
  }
  saveIdentity(fresh);
  logger.info({ email: fresh.email }, 'Identidade de nuvem criada');
  return fresh;
}

async function signIn(identity: IdentityFile): Promise<boolean> {
  if (!client) return false;
  const { error } = await client.auth.signInWithPassword({
    email: identity.email,
    password: identity.password,
  });
  if (error) {
    authStatus.autenticado = false;
    const msg = error.message.toLowerCase();
    if (msg.includes('invalid login') || msg.includes('credentials')) {
      // Conta deletada pelo admin no Supabase → revogação hard.
      authStatus.ultimoErro = 'Acesso revogado. Contate o administrador.';
    } else {
      authStatus.ultimoErro = `Login falhou: ${error.message}`;
    }
    logger.warn({ err: error.message }, 'signIn nuvem falhou');
    return false;
  }
  authStatus.autenticado = true;
  authStatus.identityEmail = identity.email;
  authStatus.machineId = identity.machineId;
  authStatus.ultimoErro = null;
  return true;
}

/**
 * Upsert da linha em `instalacoes` (atualiza last_seen + hostname + versão) e
 * lê de volta o flag `revoked` para revogação soft. Preserva o valor existente
 * de `revoked` pois não o enviamos no payload do upsert.
 */
async function registrarInstalacao(identity: IdentityFile): Promise<void> {
  if (!client || !authStatus.autenticado) return;
  try {
    const { data, error } = await client
      .from('instalacoes')
      .upsert(
        {
          machine_id: identity.machineId,
          hostname: os.hostname(),
          app_versao: app.getVersion(),
          identity_email: identity.email,
          last_seen: new Date().toISOString(),
        },
        { onConflict: 'machine_id' }
      )
      .select()
      .maybeSingle();
    if (error) {
      logger.warn({ err: error.message }, 'Falha ao registrar instalação');
      return;
    }
    if (data && (data.revoked === 1 || data.revoked === true)) {
      authStatus.revogada = true;
    }
  } catch (e: any) {
    logger.warn({ err: e }, 'Erro ao atualizar instalacoes');
  }
}

export function obterStatusCloud(): { ativo: boolean; ultimoSyncEm: string | null; ultimoSyncOk: boolean | null } {
  return {
    ativo: client !== null,
    ultimoSyncEm,
    ultimoSyncOk,
  };
}

export function obterStatusAuth(): CloudAuthStatus {
  return { ...authStatus };
}

/** Lista instalações para o painel admin (Dashboard). */
export async function listarInstalacoes(): Promise<
  Array<{ machine_id: string; hostname: string | null; app_versao: string | null; identity_email: string | null; revoked: number; last_seen: string | null }>
> {
  if (!client || !authStatus.autenticado) return [];
  const { data, error } = await client
    .from('instalacoes')
    .select('machine_id, hostname, app_versao, identity_email, revoked, last_seen')
    .order('last_seen', { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return data as any;
}

/** Revogação soft: marca revoked=1 em uma instalação (o app dela para de sincronizar). */
export async function revogarInstalacao(machineId: string): Promise<{ ok: boolean; erro: string | null }> {
  if (!client || !authStatus.autenticado) return { ok: false, erro: 'Nuvem não autenticada' };
  const { error } = await client.from('instalacoes').update({ revoked: 1 }).eq('machine_id', machineId);
  if (error) return { ok: false, erro: error.message };
  return { ok: true, erro: null };
}

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

/**
 * Inicializa o client Supabase + autentica a instalação.
 * Não bloqueia o boot em caso de falha de rede — o app segue em modo offline
 * e tenta autenticar novamente no próximo ciclo de sync (15s).
 */
export async function initCloud(): Promise<void> {
  try {
    const WebSocket = require('ws');
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
      realtime: { transport: WebSocket },
    });

    const identity = await ensureIdentity();
    if (!identity) return; // falha ao criar — retry no próximo sync
    const ok = await signIn(identity);
    if (ok) {
      await registrarInstalacao(identity);
      logger.info({ email: identity.email }, 'Supabase autenticado por instalação');
    }
  } catch (e: any) {
    logger.warn({ err: e }, 'Erro ao inicializar Supabase (offline)');
    client = client ?? null;
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

  // Garante autenticação antes de sincronizar (auto-heal de sessões expiradas
  // e boot offline). Se a instalação foi revogada (soft), não sincroniza.
  if (!authStatus.autenticado) {
    const identity = loadIdentity();
    if (identity) {
      const ok = await signIn(identity);
      if (ok) await registrarInstalacao(identity);
    }
    if (!authStatus.autenticado) return;
  }
  if (authStatus.revogada) return;

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
            logger.warn({ err: e, tabela, range: `${i}-${i + chunk.length}` }, 'Erro ao enviar chunk');
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
      logger.warn({ err: e, tabela }, 'Erro ao sincronizar tabela');
    }
  }
  } catch (e: any) {
    logger.warn({ err: e }, 'Erro no sync bidirecional');
    ultimoSyncEm = new Date().toISOString();
    ultimoSyncOk = false;
  } finally {
    syncing = false;
  }
  // Sem erros neste ponto → sync OK.
  if (ultimoSyncEm === null || ultimoSyncOk !== false) {
    ultimoSyncEm = new Date().toISOString();
    ultimoSyncOk = true;
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
      logger.warn({ arquivo: nome, err: error }, 'Erro ao enviar arquivo');
    } else {
      logger.info({ arquivo: nome }, 'Arquivo enviado');
    }
  } catch (e: any) {
    logger.warn({ err: e, arquivo: localPath }, 'Erro ao enviar arquivo');
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
        logger.info({ arquivo: row.caminho }, 'Arquivo baixado');
      } catch { /* ignora */ }
    }
  } catch (e: any) {
    logger.warn({ err: e }, 'Erro ao baixar arquivos');
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
