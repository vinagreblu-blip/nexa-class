// ============================================================
// IPC — Política de Assinatura (XAdES-EPES)
// ============================================================
// Config persistida em `configuracoes` (chave 'politica-assinatura'),
// mesmo padrão do TSA/SMTP. O SigPolicyHash é obrigatório no EPES e
// NÃO se inventa: em modo custom o digest deve ser CONFIRMADO contra o
// documento oficial no SPURI (canal POLITICA_CONFIRMAR baixa o documento,
// aplica exc-c14n + SHA-256 — o mesmo cálculo validado por dois motores
// independentes (.NET XmlDsigExcC14NTransform e xml-crypto) — e compara).
//
// Modos:
//   padrão (sem config) → PA-AD-RC v2.4 (POLITICA_ASSINATURA do signer)
//   custom              → política informada (identificador + digest + SPURI)
//   bes                 → SEM política (XAdES-BES)
import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import { getDb } from '../database';
import { IPC_CHANNELS } from '../types';
import type { ApiResult } from '../types';
import { requerAuth, requerAdmin } from './auth';
import { POLITICA_ASSINATURA, calcularDigestPolitica, type PoliticaXades } from '../diploma-digital/xades-signer';

const CHAVE = 'politica-assinatura';

export type ModoPolitica = 'padrao' | 'custom' | 'bes';

interface ConfigPolitica {
  modo: ModoPolitica;
  identificador?: string;
  digestBase64?: string;
  spuri?: string | null;
}

export interface PoliticaConfigVisao {
  modo: ModoPolitica;
  identificador: string;
  digestBase64: string;
  spuri: string;
  /** Descrição do modo padrão vigente (informativo p/ UI). */
  padraoIdentificador: string;
  padraoDigestBase64: string;
  padraoSpuri: string;
}

/** Política efetiva para o fluxo de assinatura (null = XAdES-BES). */
export function obterPoliticaAssinatura(): PoliticaXades | null {
  const db = getDb();
  const row = db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(CHAVE) as
    | { valor: string }
    | undefined;
  if (!row) return POLITICA_ASSINATURA;
  try {
    const cfg = JSON.parse(row.valor) as ConfigPolitica;
    if (cfg.modo === 'bes') return null;
    if (
      cfg.modo === 'custom' &&
      typeof cfg.identificador === 'string' && cfg.identificador.trim() &&
      typeof cfg.digestBase64 === 'string' && cfg.digestBase64.trim()
    ) {
      return {
        identificador: cfg.identificador.trim(),
        digestBase64: cfg.digestBase64.trim(),
        spuri: typeof cfg.spuri === 'string' && cfg.spuri.trim() ? cfg.spuri.trim() : undefined,
      };
    }
    return POLITICA_ASSINATURA;
  } catch {
    return POLITICA_ASSINATURA;
  }
}

function visaoAtual(): PoliticaConfigVisao {
  const db = getDb();
  const row = db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(CHAVE) as
    | { valor: string }
    | undefined;
  let cfg: ConfigPolitica = { modo: 'padrao' };
  try {
    if (row) cfg = { ...cfg, ...(JSON.parse(row.valor) as ConfigPolitica) };
  } catch { /* config corrompida → padrão */ }
  return {
    modo: cfg.modo,
    identificador: cfg.identificador ?? '',
    digestBase64: cfg.digestBase64 ?? '',
    spuri: cfg.spuri ?? '',
    padraoIdentificador: POLITICA_ASSINATURA.identificador,
    padraoDigestBase64: POLITICA_ASSINATURA.digestBase64,
    padraoSpuri: POLITICA_ASSINATURA.spuri ?? '',
  };
}

function politicaObter(_event: IpcMainInvokeEvent): ApiResult<PoliticaConfigVisao> {
  return { ok: true, data: visaoAtual() };
}

function politicaSalvar(
  _event: IpcMainInvokeEvent,
  input: { modo: ModoPolitica; identificador?: string; digestBase64?: string; spuri?: string }
): ApiResult<PoliticaConfigVisao> {
  const modo = input?.modo;
  if (modo !== 'padrao' && modo !== 'bes' && modo !== 'custom') {
    return { ok: false, error: 'Modo de política inválido (padrao | custom | bes).' };
  }
  let valor: ConfigPolitica;
  if (modo === 'custom') {
    const identificador = (input.identificador ?? '').trim();
    const digestBase64 = (input.digestBase64 ?? '').trim();
    const spuri = (input.spuri ?? '').trim();
    if (!identificador) return { ok: false, error: 'Informe o identificador da política.' };
    if (!/^urn:oid:[0-9.]+$/.test(identificador)) {
      return {
        ok: false,
        error: 'Identificador deve ser um OID em forma URN (ex.: urn:oid:2.16.76.1.7.1.9.2.4) — o Qualifier emitido é OIDAsURN.',
      };
    }
    const digest = Buffer.from(digestBase64, 'base64');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(digestBase64) || digest.length !== 32) {
      return { ok: false, error: 'Digest deve ser SHA-256 em base64 (32 bytes).' };
    }
    if (spuri && !/^https?:\/\//i.test(spuri)) {
      return { ok: false, error: 'SPURI inválido — deve começar com http(s):// .' };
    }
    valor = { modo, identificador, digestBase64, spuri: spuri || null };
  } else {
    valor = { modo };
  }
  const db = getDb();
  db.prepare(
    `INSERT INTO configuracoes (chave, valor) VALUES (?, ?)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`
  ).run(CHAVE, JSON.stringify(valor));
  return { ok: true, data: visaoAtual() };
}

/** CONFIRMA o digest contra o documento oficial no SPURI: baixa, aplica
 *  exc-c14n + SHA-256 e compara. Anti-invenção: o digest gravado precisa
 *  derivar do documento que a contra-parte vai baixar pelo SPURI. */
async function politicaConfirmar(
  _event: IpcMainInvokeEvent,
  input: { spuri: string; digestBase64: string }
): Promise<ApiResult<{ confere: boolean; calculado: string; spuriUsado: string }>> {
  const spuri = (input?.spuri ?? '').trim();
  const digestBase64 = (input?.digestBase64 ?? '').trim();
  if (!/^https?:\/\//i.test(spuri)) return { ok: false, error: 'SPURI inválido — deve começar com http(s):// .' };
  const candidatos = spuri.startsWith('https://') ? [spuri, spuri.replace(/^https:/, 'http:')] : [spuri];
  let ultimoErro = '';
  for (const url of candidatos) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 20000);
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) {
        ultimoErro = `HTTP ${res.status} em ${url}`;
        continue;
      }
      const doc = await res.text();
      const calculado = calcularDigestPolitica(doc);
      return { ok: true, data: { confere: calculado === digestBase64, calculado, spuriUsado: url } };
    } catch (e: any) {
      ultimoErro = e?.message ?? String(e);
    }
  }
  return { ok: false, error: 'Não foi possível baixar a política do SPURI (' + ultimoErro + ') — verifique a rede/a URL.' };
}

export function registrarPoliticaHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ASSINATURA_POLITICA_OBTER, requerAuth(politicaObter));
  ipcMain.handle(IPC_CHANNELS.ASSINATURA_POLITICA_SALVAR, requerAdmin(politicaSalvar));
  ipcMain.handle(IPC_CHANNELS.ASSINATURA_POLITICA_CONFIRMAR, requerAuth(politicaConfirmar));
}
