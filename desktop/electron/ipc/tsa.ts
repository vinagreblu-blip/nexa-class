// ============================================================
// IPC — Carimbo do Tempo (TSA RFC 3161 OU BRy HUB) p/ XAdES-T
// ============================================================
// Dois produtos suportados (v1.4.9):
//  • modo "rfc3161": TSA clássico (ex.: Adobe Reader) — URL + Basic
//    (usuario/senha) consumido direto pelo assinador (tsa-cliente.ts).
//  • modo "bry_hub": Carimbo do Tempo da BRy via HUB Signer (API REST
//    + JWT do token-service) — o carimbo é aplicado APÓS a assinatura
//    local (Completador /xml/v1/upgrade/signature, profile TIMESTAMP).
// Config persistida em `configuracoes` (chave 'tsa'), retrocompatível:
// config sem "modo" = rfc3161.
//
import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import { getDb } from '../database';
import { IPC_CHANNELS } from '../types';
import type { ApiResult } from '../types';
import { requerAuth, requerAdmin } from './auth';
import { carimbarDigest, sha256, type ConfigTsa } from '../diploma-digital/tsa-cliente';
import {
  type ConfigBryHub,
  URL_AUTH_BRY_PADRAO,
  URL_HUB_BRY_PRODUCAO,
  testarConexaoBry,
} from '../diploma-digital/bry-hub-cliente';
import { randomBytes } from 'node:crypto';

const CHAVE = 'tsa';

export type ModoCarimbo = 'rfc3161' | 'bry_hub';

interface ConfigCompleta {
  modo: ModoCarimbo;
  /** rfc3161 */
  url?: string;
  usuario?: string | null;
  senha?: string | null;
  /** bry_hub */
  urlAuth?: string;
  clientId?: string;
  clientSecret?: string | null;
  urlHub?: string;
}

export interface TsaConfigVisao {
  modo: ModoCarimbo;
  url: string;
  usuario: string;
  temSenha: boolean;
  urlAuth: string;
  clientId: string;
  temClientSecret: boolean;
  urlHub: string;
}

function lerConfigCompleta(): ConfigCompleta | null {
  const db = getDb();
  const row = db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(CHAVE) as
    | { valor: string }
    | undefined;
  if (!row) return null;
  try {
    const cfg = JSON.parse(row.valor) as Partial<ConfigCompleta>;
    return { modo: cfg.modo === 'bry_hub' ? 'bry_hub' : 'rfc3161', ...cfg } as ConfigCompleta;
  } catch {
    return null;
  }
}

/** Config do TSA RFC 3161 para o fluxo de assinatura (modo rfc3161 OU
 *  legado sem modo). Em modo bry_hub devolve null — o carimbo lá é
 *  pós-assinatura (ver bry-hub-cliente.ts). */
export function obterTsaConfig(): (ConfigTsa & { senha: string | null }) | null {
  const cfg = lerConfigCompleta();
  if (!cfg || cfg.modo !== 'rfc3161') return null;
  if (!cfg.url) return null;
  return { url: cfg.url, usuario: cfg.usuario ?? null, senha: cfg.senha ?? null };
}

/** Config do BRy HUB (modo bry_hub com campos completos) ou null. */
export function obterConfigBryHub(): ConfigBryHub | null {
  const cfg = lerConfigCompleta();
  if (!cfg || cfg.modo !== 'bry_hub') return null;
  if (!cfg.clientId?.trim() || !cfg.clientSecret?.trim()) return null;
  return {
    urlAuth: (cfg.urlAuth ?? URL_AUTH_BRY_PADRAO).trim(),
    clientId: cfg.clientId.trim(),
    clientSecret: cfg.clientSecret,
    urlHub: (cfg.urlHub ?? URL_HUB_BRY_PRODUCAO).trim(),
  };
}

function tsaObter(_event: IpcMainInvokeEvent): ApiResult<TsaConfigVisao | null> {
  const cfg = lerConfigCompleta();
  if (!cfg) return { ok: true, data: null };
  return {
    ok: true,
    data: {
      modo: cfg.modo,
      url: cfg.url ?? '',
      usuario: cfg.usuario ?? '',
      temSenha: !!cfg.senha,
      urlAuth: cfg.urlAuth ?? URL_AUTH_BRY_PADRAO,
      clientId: cfg.clientId ?? '',
      temClientSecret: !!cfg.clientSecret,
      urlHub: cfg.urlHub ?? URL_HUB_BRY_PRODUCAO,
    },
  };
}

function tsaSalvar(
  _event: IpcMainInvokeEvent,
  input: {
    modo: ModoCarimbo;
    url?: string;
    usuario?: string;
    senha?: string;
    manterSenhaAtual?: boolean;
    urlAuth?: string;
    clientId?: string;
    clientSecret?: string;
    manterClientSecretAtual?: boolean;
    urlHub?: string;
  }
): ApiResult<TsaConfigVisao> {
  const modo: ModoCarimbo = input.modo === 'bry_hub' ? 'bry_hub' : 'rfc3161';
  const anterior = lerConfigCompleta();

  const url = input.url?.trim() ?? '';
  if (modo === 'rfc3161') {
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'URL do TSA inválida — deve começar com http(s):// (ex.: https://tsa.fornecedor.com.br/tsp).' };
    }
  }
  const urlAuth = (input.urlAuth?.trim() || URL_AUTH_BRY_PADRAO).trim();
  const urlHub = (input.urlHub?.trim() || URL_HUB_BRY_PRODUCAO).trim();
  if (modo === 'bry_hub') {
    if (!/^https?:\/\//i.test(urlAuth)) return { ok: false, error: 'URL de autenticação BRy inválida (deve começar com http(s)://).' };
    if (!/^https?:\/\//i.test(urlHub)) return { ok: false, error: 'URL do HUB BRy inválida (deve começar com http(s)://).' };
    if (!input.clientId?.trim()) return { ok: false, error: 'Client ID da BRy é obrigatório no modo BRy HUB.' };
  }

  let senha = input.senha ?? null;
  if (input.manterSenhaAtual && !senha) senha = anterior?.senha ?? null;
  let clientSecret = input.clientSecret ?? null;
  if (input.manterClientSecretAtual && !clientSecret) clientSecret = anterior?.clientSecret ?? null;

  const db = getDb();
  const valor = JSON.stringify({
    modo,
    ...(modo === 'rfc3161' ? { url, usuario: input.usuario?.trim() || null, senha } : {}),
    ...(modo === 'bry_hub'
      ? {
          urlAuth,
          clientId: input.clientId?.trim(),
          clientSecret,
          urlHub,
        }
      : {}),
  });
  db.prepare(
    `INSERT INTO configuracoes (chave, valor) VALUES (?, ?)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`
  ).run(CHAVE, valor);
  return {
    ok: true,
    data: {
      modo,
      url,
      usuario: input.usuario?.trim() ?? '',
      temSenha: !!senha,
      urlAuth,
      clientId: input.clientId?.trim() ?? '',
      temClientSecret: !!clientSecret,
      urlHub,
    },
  };
}

/** Teste de sanidade — NÃO consome créditos:
 *  rfc3161: carimba um digest aleatório (1 carimbo);
 *  bry_hub: emite JWT (token-service) + consulta GET /infos do HUB. */
async function tsaTestar(_event: IpcMainInvokeEvent): Promise<ApiResult<{ genTime: string; bytes: number; versaoHub?: string }>> {
  const cfg = lerConfigCompleta();
  if (!cfg) return { ok: false, error: 'Configure o carimbo antes de testar.' };
  if (cfg.modo === 'bry_hub') {
    const hubCfg = obterConfigBryHub();
    if (!hubCfg) return { ok: false, error: 'Configure Client ID/Secret da BRy antes de testar.' };
    try {
      const r = await testarConexaoBry(hubCfg);
      return {
        ok: true,
        data: {
          genTime: `HUB v${r.versaoHub} acessível (rate limit ${r.rateLimit})`,
          bytes: r.tokenChars,
          versaoHub: r.versaoHub,
        },
      };
    } catch (e: any) {
      return { ok: false, error: 'Falha no teste BRy HUB: ' + (e?.message ?? String(e)) };
    }
  }
  // rfc3161 (legado)
  const rfc = obterTsaConfig();
  if (!rfc) return { ok: false, error: 'Configure a URL do TSA antes de testar.' };
  try {
    const carimbo = await carimbarDigest(rfc, sha256(randomBytes(32)), 15000);
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
