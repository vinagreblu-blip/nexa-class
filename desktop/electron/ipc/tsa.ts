// ============================================================
// IPC — Carimbo do Tempo (TSA RFC 3161) p/ XAdES-T do Diploma Digital
// ============================================================
// Config persistida em `configuracoes` (chave 'tsa'), mesmo padrão do
// SMTP. Exigência da política de assinatura da IN Sesu 1/2020: o token
// da TSA atesta a hora da assinatura — emitido por terceiro auditado,
// nunca fabricado pelo próprio app.
//
import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import { getDb } from '../database';
import { IPC_CHANNELS } from '../types';
import type { ApiResult } from '../types';
import { requerAuth, requerAdmin } from './auth';
import { carimbarDigest, sha256, type ConfigTsa } from '../diploma-digital/tsa-cliente';
import { randomBytes } from 'node:crypto';

const CHAVE = 'tsa';

export interface TsaConfigVisao {
  url: string;
  usuario: string;
  temSenha: boolean;
}

/** Lê a config TSA (para o fluxo de assinatura). */
export function obterTsaConfig(): (ConfigTsa & { senha: string | null }) | null {
  const db = getDb();
  const row = db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(CHAVE) as
    | { valor: string }
    | undefined;
  if (!row) return null;
  try {
    const cfg = JSON.parse(row.valor) as { url: string; usuario?: string; senha?: string };
    if (!cfg.url) return null;
    return { url: cfg.url, usuario: cfg.usuario ?? null, senha: cfg.senha ?? null };
  } catch {
    return null;
  }
}

function tsaObter(_event: IpcMainInvokeEvent): ApiResult<TsaConfigVisao | null> {
  const cfg = obterTsaConfig();
  return {
    ok: true,
    data: cfg ? { url: cfg.url, usuario: cfg.usuario ?? '', temSenha: !!cfg.senha } : null,
  };
}

function tsaSalvar(
  _event: IpcMainInvokeEvent,
  input: { url: string; usuario?: string; senha?: string; manterSenhaAtual?: boolean }
): ApiResult<TsaConfigVisao> {
  const url = input.url?.trim() ?? '';
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'URL do TSA inválida — deve começar com http(s):// (ex.: https://tsa.fornecedor.com.br/tsp).' };
  }
  let senha = input.senha ?? null;
  if (input.manterSenhaAtual && !senha) {
    senha = obterTsaConfig()?.senha ?? null;
  }
  const db = getDb();
  const valor = JSON.stringify({ url, usuario: input.usuario?.trim() || null, senha });
  db.prepare(
    `INSERT INTO configuracoes (chave, valor) VALUES (?, ?)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`
  ).run(CHAVE, valor);
  return { ok: true, data: { url, usuario: input.usuario?.trim() ?? '', temSenha: !!senha } };
}

/** Teste de sanidade: carimba um digest aleatório e devolve a hora da TSA. */
async function tsaTestar(_event: IpcMainInvokeEvent): Promise<ApiResult<{ genTime: string; bytes: number }>> {
  const cfg = obterTsaConfig();
  if (!cfg) return { ok: false, error: 'Configure a URL do TSA antes de testar.' };
  try {
    const carimbo = await carimbarDigest(cfg, sha256(randomBytes(32)), 15000);
    return {
      ok: true,
      data: { genTime: carimbo.genTime ?? '(hora não legível no token)', bytes: carimbo.token.length },
    };
  } catch (e: any) {
    return { ok: false, error: 'Falha no teste do TSA: ' + (e?.message ?? String(e)) };
  }
}

export function registrarTsaHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ASSINATURA_TSA_OBTER, requerAuth(tsaObter));
  ipcMain.handle(IPC_CHANNELS.ASSINATURA_TSA_SALVAR, requerAdmin(tsaSalvar));
  ipcMain.handle(IPC_CHANNELS.ASSINATURA_TSA_TESTAR, requerAuth(tsaTestar));
}
