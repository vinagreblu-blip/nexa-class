import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { app } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from './utils/logger';
import { setSuppressLocalWriteNotify } from './sqlite-adapter';
import {
  TABELAS_SINCRONIZADAS,
  aplicarLinhaRemota,
  aplicarTombstonesRemotos,
  aplicarDeleteRemoto,
  lerWatermarkPush,
  salvarWatermarkPush,
  linhaParaRemoto,
  podarTombstones,
  agoraSqlite,
  sqliteToIso,
  type TombstoneRemoto,
} from './sync-core';
import { getDb } from './database';

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
// `ultimoSyncEm` = ISO timestamp; `ultimoSyncOk` = true se foi bem-sucedido;
// `errosUltimoSync` = mensagens por tabela que falhou (push ou pull).
let ultimoSyncEm: string | null = null;
let ultimoSyncOk: boolean | null = null;
let errosUltimoSync: string[] = [];

export interface SyncResultado {
  ok: boolean;
  erros: string[];
  em: string;
}

// Notificação main → renderer ao final de cada ciclo de sync. O main.ts
// repassa via webContents.send para o indicador da sidebar (dot laranja
// quando há erro — antes a falha só aparecia no log, com dot verde).
type SyncResultadoListener = (r: SyncResultado) => void;
let onSyncResultado: SyncResultadoListener | null = null;

export function setOnSyncResultado(cb: SyncResultadoListener | null): void {
  onSyncResultado = cb;
}

// ============================================================
// NOTIFICAÇÃO DE DADOS ALTERADOS (main → renderer)
// ============================================================
// Chamado ao final de cada sync/realtime que aplicou mudanças vindas da
// nuvem. O main.ts registra o callback que reenvia via webContents.send
// para todas as janelas — as telas recarregam suas listas sem F5.

type DadosAlteradosListener = (tabelas: Set<string>) => void;
let onDadosAlterados: DadosAlteradosListener | null = null;

export function setOnDadosAlterados(cb: DadosAlteradosListener | null): void {
  onDadosAlterados = cb;
}

function notificarDadosAlterados(tabelas: Set<string>): void {
  if (tabelas.size === 0 || !onDadosAlterados) return;
  try {
    onDadosAlterados(new Set(tabelas));
  } catch (e: any) {
    logger.warn({ err: e }, 'Callback de dados alterados falhou');
  }
}

/** Emite notificação de dados alterados (usado também pelo realtime.ts). */
export function emitirDadosAlterados(tabelas: Set<string>): void {
  notificarDadosAlterados(tabelas);
}

// Autenticação restaurada (offline → online): o realtime re-assina o canal
// com o token novo. Registrado por realtime.ts.
type AuthRestauradaListener = () => void;
let onAuthRestaurada: AuthRestauradaListener | null = null;

export function setOnAuthRestaurada(cb: AuthRestauradaListener | null): void {
  onAuthRestaurada = cb;
}

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

/** Cria identidade Supabase Auth na primeira execução; reusa a existente depois. */
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
  const antes = authStatus.autenticado;
  authStatus.autenticado = true;
  authStatus.identityEmail = identity.email;
  authStatus.machineId = identity.machineId;
  authStatus.ultimoErro = null;
  // Boot offline → online: realtime precisa re-assinar com o token novo.
  if (!antes && onAuthRestaurada) {
    try {
      onAuthRestaurada();
    } catch { /* ignora */ }
  }
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

export function obterStatusCloud(): {
  ativo: boolean;
  ultimoSyncEm: string | null;
  ultimoSyncOk: boolean | null;
  erros: string[];
} {
  return {
    ativo: client !== null,
    ultimoSyncEm,
    ultimoSyncOk,
    erros: errosUltimoSync,
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
// SYNC BIDIRECIONAL INCREMENTAL (multiusuário, 5+ máquinas)
// ============================================================
// Ordem de cada ciclo (importante para não ressuscitar excluídos):
//   1. PULL de linhas modificadas (watermark + sobreposição p/ clock skew)
//   2. PULL de tombstones (`delecoes`) e aplicação dos DELETEs
//   3. PUSH de linhas modificadas localmente (watermark incremental)
//   4. PUSH de tombstones novos + DELETE das linhas remotas correspondentes
//
// Concorrência: last-write-wins por updated_at. Duplicatas evitadas pelas
// chaves únicas (id/matricula/username) + upsert idempotente.

const PAGE_SIZE = 1000;
const CHUNK_SIZE = 500;
// Sobreposição dos watermarks de pull (5 min) — tolera clock skew entre
// máquinas (timestamps são gerados pelos relógios locais de origem).
const PULL_OVERLAP_MS = 5 * 60 * 1000;

const WM_PULL_PREFIXO = 'sync_pull_wm_';
const WM_PULL_DEL_PREFIXO = 'sync_pull_del_wm_';
const WM_PUSH_DEL_PREFIXO = 'sync_push_del_wm_';

function lerConfig(db: any, chave: string): string | null {
  try {
    const row = db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave) as
      | { valor?: string }
      | undefined;
    return row?.valor ?? null;
  } catch {
    return null;
  }
}

function salvarConfig(db: any, chave: string, valor: string): void {
  db.prepare(
    `INSERT INTO configuracoes (chave, valor) VALUES (?, ?)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`
  ).run(chave, valor);
}

/** Watermark de pull em ISO, com sobreposição para clock skew. */
function wmPullIso(db: any, tabela: string): string | null {
  const wm = lerConfig(db, WM_PULL_PREFIXO + tabela);
  if (!wm) return null;
  const t = new Date(sqliteToIso(wm)).getTime() - PULL_OVERLAP_MS;
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function tsMax(a: string | null, b: string | null): string {
  if (!a) return b ?? '';
  if (!b) return a;
  return new Date(sqliteToIso(a)).getTime() >= new Date(sqliteToIso(b)).getTime() ? a : b;
}

/** Sync bidirecional completo — resolve conflitos por updated_at */
export async function syncBidirecional(getDbFn: () => any): Promise<void> {
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
  // Escritas abaixo aplicam dados da NUvem — não devem disparar o push
  // acelerado (senão cada pull geraria um push em loop).
  setSuppressLocalWriteNotify(true);
  const alteradas = new Set<string>();
  // Erros por tabela (primeira mensagem de cada uma) — alimenta o
  // indicador da UI e o Dashboard. Antes disto, um push rejeitado pelo
  // Supabase (ex.: coluna ausente — drift de schema) só gerava logger.warn
  // e o app ficava "verde" sem sincronizar nada daquela tabela.
  const erros = new Map<string, string>();
  const registrarErro = (tabela: string, msg: string): void => {
    if (!erros.has(tabela)) erros.set(tabela, msg);
  };

  try {
    const db = getDbFn();

    // 0. Poda de tombstones antigos (mesma retenção do Supabase: 90 dias)
    try {
      podarTombstones(db);
    } catch { /* ignora */ }

    for (const tabela of TABELAS_SINCRONIZADAS) {
      try {
        const localCols = (db.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[]).map(
          (c) => c.name
        );
        if (localCols.length === 0) continue;

        // 1. PULL incremental de linhas
        const wm = wmPullIso(db, tabela);
        let fromOffset = 0;
        let hasMore = true;
        let maxTsVisto: string | null = null;
        while (hasMore) {
          // Builder NÃO pode ser reutilizado entre requests — construir a
          // query fresh a cada página (supabase-js resolve uma vez só).
          let q = client.from(tabela).select('*');
          if (wm) q = q.gte('updated_at', wm);
          const { data: remoteRows, error } = await q
            .order('id', { ascending: true })
            .range(fromOffset, fromOffset + PAGE_SIZE - 1);
          if (error) throw error;
          if (!remoteRows || remoteRows.length === 0) {
            hasMore = false;
            break;
          }
          if (remoteRows.length < PAGE_SIZE) hasMore = false;
          fromOffset += PAGE_SIZE;

          for (const row of remoteRows) {
            try {
              if (aplicarLinhaRemota(db, tabela, row)) alteradas.add(tabela);
              if (row.updated_at) maxTsVisto = tsMax(maxTsVisto, String(row.updated_at));
            } catch { /* ignora linha com erro */ }
          }
        }
        if (maxTsVisto) salvarConfig(db, WM_PULL_PREFIXO + tabela, agoraSqlite());

        // 2. Atualiza autoincrement local para evitar conflito de IDs
        const maxRow = db.prepare(`SELECT MAX(id) as mx FROM ${tabela}`).get() as { mx?: number } | undefined;
        if (maxRow?.mx) {
          try {
            db.prepare('UPDATE sqlite_sequence SET seq = ? WHERE name = ?').run(maxRow.mx, tabela);
          } catch { /* tabela sem autoincrement */ }
        }
      } catch (e: any) {
        registrarErro(tabela, `pull: ${e?.message ?? String(e)}`);
        logger.warn({ err: e, tabela }, 'Erro no pull da tabela');
      }
    }

    // 2.5. PULL de tombstones (deleções feitas em outras máquinas)
    try {
      const wmDel = lerConfig(db, WM_PULL_DEL_PREFIXO);
      let overlap: string | null = null;
      if (wmDel) {
        overlap = new Date(new Date(sqliteToIso(wmDel)).getTime() - PULL_OVERLAP_MS).toISOString();
      }
      let fromOffset = 0;
      let hasMore = true;
      let aplicou = false;
      while (hasMore) {
        let q = client.from('delecoes').select('tabela, id, deleted_at');
        if (overlap) q = q.gte('deleted_at', overlap);
        const { data: tombstones, error } = await q
          .order('deleted_at', { ascending: true })
          .order('tabela', { ascending: true })
          .order('id', { ascending: true })
          .range(fromOffset, fromOffset + PAGE_SIZE - 1);
        if (error) throw error;
        if (!tombstones || tombstones.length === 0) break;
        if (tombstones.length < PAGE_SIZE) hasMore = false;
        fromOffset += PAGE_SIZE;
        aplicou = true;
        for (const t of aplicarTombstonesRemotos(db, tombstones as TombstoneRemoto[])) {
          alteradas.add(t);
        }
      }
      if (aplicou) salvarConfig(db, WM_PULL_DEL_PREFIXO, agoraSqlite());
    } catch (e: any) {
      logger.warn({ err: e }, 'Erro no pull de tombstones');
    }

    // 3. PUSH incremental de linhas (watermark por tabela)
    for (const tabela of TABELAS_SINCRONIZADAS) {
      try {
        const localCols = (db.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[]).map(
          (c) => c.name
        );
        if (localCols.length === 0) continue;
        // usuários: não reenvia o admin local (senha é por instalação)
        const whereAdmin = tabela === 'usuarios' ? " WHERE username != 'admin'" : '';
        const wmAntigo = lerWatermarkPush(db, tabela);
        const inicioTs = agoraSqlite();
        const rows = wmAntigo === null
          ? db.prepare(`SELECT * FROM ${tabela}${whereAdmin}`).all()
          : db.prepare(`SELECT * FROM ${tabela}${whereAdmin ? whereAdmin + ' AND' : ' WHERE'} (updated_at IS NULL OR updated_at >= ?)`).all(wmAntigo);
        if (rows.length === 0) {
          salvarWatermarkPush(db, tabela, inicioTs);
          continue;
        }
        const batch = rows.map(linhaParaRemoto);
        let falhou = false;
        for (let i = 0; i < batch.length; i += CHUNK_SIZE) {
          const chunk = batch.slice(i, i + CHUNK_SIZE);
          try {
            const { error } = await client.from(tabela).upsert(chunk);
            if (error) {
              falhou = true;
              registrarErro(tabela, `push: ${error.message}`);
              logger.warn({ err: error.message, tabela, range: `${i}-${i + chunk.length}` }, 'Erro ao enviar chunk');
            }
          } catch (e: any) {
            falhou = true;
            registrarErro(tabela, `push: ${e?.message ?? String(e)}`);
            logger.warn({ err: e, tabela, range: `${i}-${i + chunk.length}` }, 'Erro ao enviar chunk');
          }
        }
        // Só avança o watermark se TODOS os chunks foram aceitos — em caso
        // de falha parcial, o próximo ciclo reenvia (upsert idempotente).
        if (!falhou) salvarWatermarkPush(db, tabela, inicioTs);
      } catch (e: any) {
        registrarErro(tabela, `push: ${e?.message ?? String(e)}`);
        logger.warn({ err: e, tabela }, 'Erro no push da tabela');
      }
    }

    // 4. PUSH de tombstones novos + DELETE remoto das linhas correspondentes
    try {
      const wmDelPush = lerConfig(db, WM_PUSH_DEL_PREFIXO);
      const inicioTs = agoraSqlite();
      const novos = wmDelPush === null
        ? (db.prepare('SELECT tabela, id, deleted_at FROM delecoes').all() as TombstoneRemoto[])
        : (db
            .prepare('SELECT tabela, id, deleted_at FROM delecoes WHERE deleted_at >= ?')
            .all(wmDelPush) as TombstoneRemoto[]);
      if (novos.length > 0) {
        const { error } = await client.from('delecoes').upsert(novos);
        if (error) throw error;

        // Deleta as linhas remotas agrupadas por tabela
        const porTabela = new Map<string, number[]>();
        for (const t of novos) {
          const arr = porTabela.get(t.tabela) ?? [];
          arr.push(t.id);
          porTabela.set(t.tabela, arr);
        }
        for (const [tabela, ids] of porTabela) {
          if (!TABELAS_SINCRONIZADAS.includes(tabela as any)) continue;
          for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
            const chunk = ids.slice(i, i + CHUNK_SIZE);
            const { error: delErr } = await client.from(tabela).delete().in('id', chunk);
            if (delErr) logger.warn({ err: delErr.message, tabela }, 'Erro ao deletar remoto');
          }
        }
      }
      salvarConfig(db, WM_PUSH_DEL_PREFIXO, inicioTs);
    } catch (e: any) {
      registrarErro('delecoes', `tombstones: ${e?.message ?? String(e)}`);
      logger.warn({ err: e }, 'Erro no push de tombstones');
    }
  } catch (e: any) {
    logger.warn({ err: e }, 'Erro no sync bidirecional');
    ultimoSyncEm = new Date().toISOString();
    ultimoSyncOk = false;
    errosUltimoSync = [`sync: ${e?.message ?? String(e)}`];
  } finally {
    setSuppressLocalWriteNotify(false);
    syncing = false;
  }

  // Sync concluído sem exceção global: OK só se NENHUMA tabela falhou
  // (antes qualquer ciclo sem exceção marcava ok=true mesmo com pushes
  // rejeitados — era impossível detectar drift de schema pela UI).
  if (ultimoSyncOk !== false) {
    errosUltimoSync = Array.from(erros.entries()).map(([tabela, msg]) => `${tabela} — ${msg}`);
    ultimoSyncOk = errosUltimoSync.length === 0;
    ultimoSyncEm = new Date().toISOString();
  }
  if (onSyncResultado) {
    try {
      onSyncResultado({
        ok: ultimoSyncOk === true,
        erros: errosUltimoSync,
        em: ultimoSyncEm ?? new Date().toISOString(),
      });
    } catch (e: any) {
      logger.warn({ err: e }, 'Callback de resultado de sync falhou');
    }
  }
  notificarDadosAlterados(alteradas);
}

// ============================================================
// PUSH ACELERADO (mutação local → nuvem em ~2.5s)
// ============================================================
// O sqlite-adapter notifica cada escrita LOCAL (mutations do usuário). O
// debounce agrega rajadas de escrita em um único sync — os outros usuários
// recebem a mudança em segundos via realtime, sem esperar o ciclo de 15s.

const FAST_SYNC_DELAY_MS = 2500;
let fastSyncTimer: NodeJS.Timeout | null = null;

export function agendarSyncRapido(delayMs: number = FAST_SYNC_DELAY_MS): void {
  if (!client) return; // nuvem não inicializada / offline — ciclo de 15s cobre
  if (fastSyncTimer) return; // já agendado (debounce)
  fastSyncTimer = setTimeout(() => {
    fastSyncTimer = null;
    syncBidirecional(getDb).catch((e: any) => {
      logger.warn({ err: e }, 'Sync rápido falhou');
    });
  }, delayMs);
}

/**
 * Executa `fn` segurando o mutex do sync, de forma que o sync periódico (a cada
 * 15s) não rode durante a operação. Usado para exclusões que precisam apagar o
 * registro local e remoto atomicamente — sem isso, um sync no meio da operação
 * poderia re-inserir (PULL) ou re-enviar (PUSH) o registro e ressuscitá-lo.
 */
export async function withSyncLock<T>(fn: () => T | Promise<T>): Promise<T> {
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
// COMPATIBILIDADE COM O REALTIME (realtime.ts chama estes helpers)
// ============================================================

/** Aplica um evento postgres_changes vindo do Realtime. Exportado para testes. */
export async function aplicarEventoRealtime(
  getDbFn: () => any,
  evento: { tipo: 'INSERT' | 'UPDATE' | 'DELETE'; tabela: string; row: Record<string, any> | null; id: number | null; commitTimestamp: string | null }
): Promise<boolean> {
  return withSyncLock(() => {
    const db = getDbFn();
    setSuppressLocalWriteNotify(true);
    try {
      if (evento.tipo === 'DELETE' && evento.id != null) {
        return aplicarDeleteRemoto(db, evento.tabela, evento.id, evento.commitTimestamp ?? undefined);
      }
      if (evento.row) {
        return aplicarLinhaRemota(db, evento.tabela, evento.row);
      }
      return false;
    } finally {
      setSuppressLocalWriteNotify(false);
    }
  });
}

// ============================================================
// COMPATIBILIDADE COM CÓDIGO ANTIGO
// ============================================================

export async function syncFromCloud(getDbFn: () => any): Promise<{ synced: number }> {
  await syncBidirecional(getDbFn);
  return { synced: 0 };
}

export async function pushToCloud(): Promise<void> {
  // No-op: sync é bidirecional agora
}
