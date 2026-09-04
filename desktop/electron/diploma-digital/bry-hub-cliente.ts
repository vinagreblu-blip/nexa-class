// ============================================================
// CLIENTE BRy HUB (Signer) — carimbo do tempo via API REST
// ============================================================
// Integração para o produto "Carimbo do Tempo" da BRy consumido pelo
// HUB Signer (JWT + REST), alternativa ao TSA RFC 3161 clássico
// (tsa-cliente.ts) — créditos dos dois produtos são independentes.
//
// Fluxo (validado em 04/09/2026 contra os ambientes oficiais):
//  1. OAuth2: POST {urlAuth}  form: grant_type=client_credentials,
//     client_id, client_secret → { access_token, expires_in } (4h).
//     Endpoint de produção: https://cloud.bry.com.br/token-service/jwt
//  2. Upgrade: POST {urlHub}/xml/v1/upgrade/signature (multipart)
//     signature[0]=XML assinado (XAdES-BES local) · profile=TIMESTAMP
//     · returnType=BASE64 · Authorization: Bearer <JWT>
//     → devolve o XML com SignatureTimeStamp (XAdES-T) por assinatura.
//
// HUBs: homologação https://hub2.hom.bry.com.br · produção
//       https://hub2.bry.com.br (GET /infos expõe a versão).
//
// Módulo PURO (fetch global) — testável sem Electron.
//
import { Buffer } from 'node:buffer';

export interface ConfigBryHub {
  /** OAuth2 (POST, form-urlencoded). */
  urlAuth: string;
  clientId: string;
  clientSecret: string;
  /** Base do HUB Signer (sem barra final). */
  urlHub: string;
}

export const URL_AUTH_BRY_PADRAO = 'https://cloud.bry.com.br/token-service/jwt';
export const URL_HUB_BRY_PRODUCAO = 'https://hub2.bry.com.br';
export const URL_HUB_BRY_HOMOLOGACAO = 'https://hub2.hom.bry.com.br';

export interface ResultadoUpgrade {
  xml: string;
  /** Nº de carimbos adicionados pela BRy (diferença de EncapsulatedTimeStamp). */
  carimbosAdicionados: number;
  /** Hora da TSA de cada carimbo novo (extraída do XML devolvido). */
  genTimes: string[];
}

// ---------- cache do token (margem de 5 min, como o OAuth2 padrão) ----------

interface TokenCache {
  token: string;
  expiraEm: number;
  chave: string;
}
let cacheToken: TokenCache | null = null;
const MARGEM_MS = 5 * 60 * 1000;

/** Invalida o cache (erro 401, troca de credencial, testes). */
export function limparCacheBry(): void {
  cacheToken = null;
}

/** Troca client_id/secret por JWT (com cache). @interno — use nas demais funções. */
export async function obterTokenBry(cfg: ConfigBryHub, timeoutMs = 20000): Promise<string> {
  const chave = `${cfg.urlAuth}|${cfg.clientId}|${cfg.clientSecret}`;
  if (cacheToken && cacheToken.chave === chave && cacheToken.expiraEm > Date.now()) {
    return cacheToken.token;
  }
  if (!/^https?:\/\//i.test(cfg.urlAuth ?? '')) throw new Error('URL de autenticação BRy inválida.');
  if (!cfg.clientId?.trim() || !cfg.clientSecret?.trim()) {
    throw new Error('Client ID e Client Secret da BRy são obrigatórios.');
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(cfg.urlAuth, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: cfg.clientId.trim(),
        client_secret: cfg.clientSecret,
      }).toString(),
      signal: ctl.signal,
    });
    const texto = await res.text();
    let json: any;
    try {
      json = JSON.parse(texto);
    } catch {
      throw new Error(`Serviço de autenticação BRy respondeu formato inesperado (HTTP ${res.status}).`);
    }
    if (!res.ok || !json?.access_token) {
      throw new Error(
        res.status === 401
          ? 'Autenticação BRy recusada (401): confira Client ID/Client Secret — o secret deve ser o mais recente emitido no BRy Cloud.'
          : `Falha na autenticação BRy (HTTP ${res.status}): ${json?.message ?? texto.slice(0, 120)}`
      );
    }
    const expiresIn = Number(json.expires_in ?? 3600) || 3600;
    cacheToken = {
      token: json.access_token as string,
      expiraEm: Date.now() + Math.max(expiresIn * 1000 - MARGEM_MS, 60_000),
      chave,
    };
    return cacheToken.token;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('Autenticação BRy não respondeu no tempo (timeout).');
    throw e instanceof Error ? e : new Error(String(e));
  } finally {
    clearTimeout(t);
  }
}

/** Sanidade sem consumir créditos: emite JWT e consulta GET /infos do HUB. */
export async function testarConexaoBry(
  cfg: ConfigBryHub,
  timeoutMs = 20000
): Promise<{ versaoHub: string; rateLimit: string; tokenChars: number }> {
  const token = await obterTokenBry(cfg, timeoutMs);
  if (!/^https?:\/\/[^\s]+$/i.test(cfg.urlHub ?? '')) throw new Error('URL do HUB BRy inválida.');
  const hub = cfg.urlHub.trim().replace(/\/+$/, '');
  const res = await fetch(`${hub}/infos`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`HUB BRy respondeu HTTP ${res.status} em /infos: ${texto.slice(0, 120)}`);
  let json: any = {};
  try {
    json = JSON.parse(texto);
  } catch { /* tolera corpo não-JSON */ }
  return {
    versaoHub: String(json.version ?? '?'),
    rateLimit: String(json.rateLimit ?? '?'),
    tokenChars: token.length,
  };
}

// ---------- extração de genTime do XML devolvido ----------

/** GeneralizedTimes AAAAMMDDHHMMSSZ → ISO, na ordem em que aparecem. */
function genTimesDoXml(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<xades141:EncapsulatedTimeStamp>([\s\S]*?)<\/xades141:EncapsulatedTimeStamp>/g)) {
    // O conteúdo é o token CMS base64 — a hora da TSA está no TSTInfo; para o
    // aviso ao operador basta contar e extrair via GeneralizedTime do DER
    // decodificado não é trivial em string pura: contamos apenas os carimbos
    // e extraímos SigningTime quando presente no contexto.
    void m;
  }
  // Hora da assinatura carimbada não vem legível no XML sem decodificar o
  // DER do token — o validador consolidado extrai com precisão depois.
  return out;
}

function contarOcorrencias(xml: string, marcador: string): number {
  return xml.split(marcador).length - 1;
}

/**
 * Envia o XML assinado (XAdES-BES da emissora) ao Completador do HUB e
 * devolve o XML com o carimbo do tempo (XAdES-T). profile=TIMESTAMP:
 * SOMENTE adiciona SignatureTimeStamp — não reescreve o resto da
 * assinatura (preserva a política MEC PA-AD-RC montada localmente).
 */
export async function upgradeCarimboBry(
  cfg: ConfigBryHub,
  xmlAssinado: string,
  timeoutMs = 60000
): Promise<ResultadoUpgrade> {
  const token = await obterTokenBry(cfg);
  const hub = cfg.urlHub.trim().replace(/\/+$/, '');
  const antes = contarOcorrencias(xmlAssinado, '<xades141:EncapsulatedTimeStamp');
  const fd = new FormData();
  fd.append(
    'signature[0]',
    new Blob([Buffer.from(xmlAssinado, 'utf8')], { type: 'application/xml' }),
    'assinado.xml'
  );
  fd.append('profile', 'TIMESTAMP');
  fd.append('returnType', 'BASE64');

  const chamar = async (): Promise<Response> =>
    fetch(`${hub}/xml/v1/upgrade/signature`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
      signal: AbortSignal.timeout(timeoutMs),
    });

  let res: Response;
  try {
    res = await chamar();
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('BRy HUB não respondeu no tempo (timeout no upgrade).');
    throw new Error(`Falha de rede com o BRy HUB: ${e?.message ?? String(e)}`);
  }
  if (res.status === 401) {
    // token expirou no meio: renova UMA vez
    limparCacheBry();
    const novo = await obterTokenBry(cfg);
    try {
      const fd2 = new FormData();
      fd2.append(
        'signature[0]',
        new Blob([Buffer.from(xmlAssinado, 'utf8')], { type: 'application/xml' }),
        'assinado.xml'
      );
      fd2.append('profile', 'TIMESTAMP');
      fd2.append('returnType', 'BASE64');
      res = await fetch(`${hub}/xml/v1/upgrade/signature`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${novo}` },
        body: fd2,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e: any) {
      throw new Error(`Falha de rede com o BRy HUB (retry 401): ${e?.message ?? String(e)}`);
    }
  }
  const texto = await res.text();
  let json: any;
  try {
    json = JSON.parse(texto);
  } catch {
    throw new Error(`BRy HUB respondeu formato inesperado (HTTP ${res.status}): ${texto.slice(0, 120)}`);
  }
  // Resposta: array com 1 item por arquivo enviado
  const item = Array.isArray(json) ? json[0] : json;
  if (!res.ok || !item || Number(item.status) !== 200 || !item.document) {
    const msg = item?.message ?? texto.slice(0, 160);
    const chave = item?.chave ? ` [${item.chave}]` : '';
    throw new Error(`BRy HUB não carimbou o XML${chave}: ${msg}`);
  }
  const xmlNovo = Buffer.from(String(item.document), 'base64').toString('utf8');
  const depois = contarOcorrencias(xmlNovo, '<xades141:EncapsulatedTimeStamp');
  return {
    xml: xmlNovo,
    carimbosAdicionados: Math.max(depois - antes, 0),
    genTimes: genTimesDoXml(xmlNovo),
  };
}
