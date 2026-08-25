// ============================================================
// REALTIME — sincronização instantânea via Supabase Realtime
// ============================================================
// Assina postgres_changes (INSERT/UPDATE/DELETE) das tabelas sincronizadas.
// Cada evento é aplicado no SQLite local imediatamente (mesma lógica LWW do
// sync) e as telas são notificadas — os outros usuários veem a mudança sem
// F5. O ciclo de 15s (cloud.ts) permanece como rede de segurança para o que
// escapar (ex.: máquina offline durante o evento).
//
// Reconexão: o canal do supabase-js reconecta sozinho; além disso, um retry
// manual com backoff re-cria o canal em caso de CHANNEL_ERROR/TIMED_OUT.
// Ao voltar (offline → online), um sync completo recupera o que foi perdido.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { logger } from './utils/logger';
import { getClient, syncBidirecional, setOnAuthRestaurada, aplicarEventoRealtime, emitirDadosAlterados } from './cloud';
import { TABELAS_SINCRONIZADAS } from './sync-core';
import { getDb } from './database';

export type EstadoConexao = 'conectando' | 'online' | 'offline';

let channel: RealtimeChannel | null = null;
let estado: EstadoConexao = 'conectando';
let jaEsteveOnline = false;
let retryTimer: NodeJS.Timeout | null = null;
let retryDelayMs = 5000;

type EstadoListener = (estado: EstadoConexao) => void;
let onEstado: EstadoListener | null = null;

export function setOnEstadoConexao(cb: EstadoListener | null): void {
  onEstado = cb;
}

export function obterEstadoConexao(): EstadoConexao {
  return estado;
}

function setEstado(novo: EstadoConexao): void {
  if (estado === novo) return;
  const anterior = estado;
  estado = novo;
  try {
    onEstado?.(novo);
  } catch (e: any) {
    logger.warn({ err: e }, 'Callback de estado de conexão falhou');
  }
  // Reconexão após queda: sync completo para recuperar mudanças do período
  // offline (o pull incremental + tombstones cobrem tudo; upsert idempotente
  // evita duplicação).
  if (anterior !== 'online' && novo === 'online' && jaEsteveOnline) {
    syncBidirecional(getDb).catch((e: any) => {
      logger.warn({ err: e }, 'Sync pós-reconexão falhou');
    });
  }
  if (novo === 'online') {
    jaEsteveOnline = true;
    retryDelayMs = 5000;
  }
}

function removerCanal(): void {
  if (!channel) return;
  try {
    getClient()?.removeChannel(channel);
  } catch { /* ignora */ }
  channel = null;
}

function criarCanal(): void {
  const client = getClient();
  if (!client) return;
  removerCanal();

  channel = client.channel('nexa-sync-realtime');
  for (const tabela of TABELAS_SINCRONIZADAS) {
    for (const evento of ['INSERT', 'UPDATE', 'DELETE'] as const) {
      channel.on(
        'postgres_changes',
        { event: evento, schema: 'public', table: tabela },
        (payload: any) => {
          void tratarEvento(payload);
        }
      );
    }
  }

  channel.subscribe((status, err) => {
    if (status === 'SUBSCRIBED') {
      setEstado('online');
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      // CLOSED é ignorado: dispara também quando NÓS removemos o canal no
      // re-subscribe — tratar como queda criaria um loop de recriação.
      logger.warn({ status, err: err?.message }, 'Canal realtime caiu — tentando reconectar');
      setEstado('offline');
      agendarRetry();
    }
  });
}

function agendarRetry(): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    criarCanal();
  }, retryDelayMs);
  retryDelayMs = Math.min(retryDelayMs * 2, 30000);
}

async function tratarEvento(payload: any): Promise<void> {
  try {
    const tabela: string = payload?.table;
    const tipo: string = payload?.eventType;
    if (!tabela || !TABELAS_SINCRONIZADAS.includes(tabela as any)) return;
    if (tipo !== 'INSERT' && tipo !== 'UPDATE' && tipo !== 'DELETE') return;

    if (tipo === 'DELETE') {
      // REPLICA IDENTITY FULL garante o id no payload `old`
      const id = payload?.old?.id;
      if (id == null) return;
      const mudou = await aplicarEventoRealtime(getDb, {
        tipo: 'DELETE',
        tabela,
        row: null,
        id: Number(id),
        commitTimestamp: payload?.commit_timestamp ?? null,
      });
      if (mudou) emitirDadosAlterados(new Set([tabela]));
    } else {
      const row = payload?.new;
      if (!row || row.id == null) return;
      const mudou = await aplicarEventoRealtime(getDb, {
        tipo,
        tabela,
        row,
        id: Number(row.id),
        commitTimestamp: null,
      });
      if (mudou) emitirDadosAlterados(new Set([tabela]));
    }
  } catch (e: any) {
    logger.warn({ err: e }, 'Erro ao aplicar evento realtime');
  }
}

/**
 * Inicia a assinatura realtime. Chamar após initCloud(). Se a autenticação
 * da instalação for restaurada depois (boot offline → online), o canal é
 * re-criado para usar o token novo.
 */
export function iniciarRealtime(): void {
  setOnAuthRestaurada(() => {
    logger.info('Auth restaurada — re-assinando canal realtime');
    criarCanal();
  });
  criarCanal();
}

export function fecharRealtime(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  removerCanal();
}
