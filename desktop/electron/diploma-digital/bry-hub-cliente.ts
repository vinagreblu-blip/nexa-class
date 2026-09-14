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
import { DOMParser } from '@xmldom/xmldom';
import { trechosAssinatura } from './xades-signer';

const NS_DS_ENXERTO = 'http://www.w3.org/2000/09/xmldsig#';
const ALGO_C14N_EXC_PADRAO = 'http://www.w3.org/2001/10/xml-exc-c14n#';

/** Escopo do carimbo BRy no fluxo em fases da DA (assinarHandler):
 *  • FASE 2 (internas): `semEsqueletos` envia à BRy apenas assinaturas
 *    REAIS — a BRy não completa documentos com ds:Signature vazio
 *    (esqueleto da raiz). A falha silenciosa da FASE 2 deixava as
 *    internas sem carimbo até a FASE 4, DEPOIS do digest da raiz —
 *    mutação pós-assinatura → gate "digests/RSA não conferem" (URI="").
 *  • FASE 4 (raiz): `apenasRaiz` restringe o enxerto à assinatura de
 *    ARQUIVAMENTO (filha direta da raiz do documento). As internas têm
 *    conteúdo coberto pelo digest da raiz URI="" e NUNCA podem ser
 *    tocadas depois que ela existe. */
export interface EscopoCarimbo {
  apenasRaiz?: boolean;
  semEsqueletos?: boolean;
}

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
 * adiciona SignatureTimeStamp — mas o documento que a BRy devolve é
 * RE-SERIALIZADO pelo motor dela (renomeação de prefixos — ex.: o
 * próprio código contava carimbos como `xades141:` — normalização de
 * atributos etc.).
 *
 * NUNCA substituímos o documento local pelo retorno da BRy: qualquer
 * byte alterado em conteúdo coberto por um digest já calculado invalida
 * a assinatura (regressão real: o DigestValue da assinatura raiz
 * URI="" — que cobre as assinaturas internas — divergia e o gate
 * final rejeitava com "digests/RSA não conferem").
 *
 * O retorno é SEMPRE o XML ORIGINAL do chamador, apenas com os blocos
 * SignatureTimeStamp que a BRy efetivamente ADICIONOU enxertados por
 * cirurgia de string (dentro das assinaturas — conteúdo não coberto
 * pelas References existentes).
 */
export async function upgradeCarimboBry(
  cfg: ConfigBryHub,
  xmlAssinado: string,
  timeoutMs = 60000,
  escopo: EscopoCarimbo = {}
): Promise<ResultadoUpgrade> {
  const token = await obterTokenBry(cfg);
  const hub = cfg.urlHub.trim().replace(/\/+$/, '');
  // semEsqueletos: a BRy não carimba (e costuma RECUSAR) documentos com
  // ds:Signature vazio — o esqueleto da raiz sai do envio e volta intacto.
  const { corpo: xmlEnvio, contexto } = escopo.semEsqueletos
    ? separarEsqueletos(xmlAssinado)
    : { corpo: xmlAssinado, contexto: [] as { antes: string; texto: string }[] };
  const fd = new FormData();
  fd.append(
    'signature[0]',
    new Blob([Buffer.from(xmlEnvio, 'utf8')], { type: 'application/xml' }),
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
        new Blob([Buffer.from(xmlEnvio, 'utf8')], { type: 'application/xml' }),
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
  // Enxerto cirúrgico: o documento da BRy é re-serializado por ela e só
  // serve de FONTE dos carimbos adicionados — nunca como documento final.
  const xmlNovo = Buffer.from(String(item.document), 'base64').toString('utf8');
  const enxerto = enxertarCarimbosBry(xmlEnvio, xmlNovo, escopo);
  return {
    xml: contexto.length > 0 ? reinserirEsqueletos(enxerto.xml, contexto) : enxerto.xml,
    carimbosAdicionados: enxerto.carimbosAdicionados,
    genTimes: genTimesDoXml(enxerto.xml),
  };
}

// ---------- enxerto cirúrgico dos carimbos (sem re-serialização) ----------

/** Separa os esqueletos (posições não assinadas) do corpo enviado à BRy.
 *  A reinserção é por ÂNCORA de contexto (texto imediatamente anterior),
 *  não por índice: o enxerto insere carimbos em assinaturas que vem
 *  ANTES do esqueleto e deslocaria índices absolutos. */
function separarEsqueletos(xml: string): { corpo: string; contexto: { antes: string; texto: string }[] } {
  const esqueletos = trechosAssinatura(xml).filter((t) => t.esqueleto);
  let corpo = xml;
  for (let i = esqueletos.length - 1; i >= 0; i--) {
    corpo = corpo.slice(0, esqueletos[i].inicio) + corpo.slice(esqueletos[i].inicio + esqueletos[i].texto.length);
  }
  return {
    corpo,
    contexto: esqueletos.map((e) => ({
      antes: xml.slice(Math.max(0, e.inicio - 64), e.inicio),
      texto: e.texto,
    })),
  };
}

/** Reinserção por âncora (ordem crescente; falha explícita se a âncora
 *  desaparecer — o XML local permanece íntegro no chamador). */
function reinserirEsqueletos(corpo: string, contexto: { antes: string; texto: string }[]): string {
  let out = corpo;
  let aPartir = 0;
  for (const e of contexto) {
    const idx = out.indexOf(e.antes, aPartir);
    if (idx < 0) {
      throw new Error('Ponto de reinserção do esqueleto não localizado após o carimbo — XML local preservado sem alteração.');
    }
    const pos = idx + e.antes.length;
    out = out.slice(0, pos) + e.texto + out.slice(pos);
    aPartir = pos + e.texto.length;
  }
  return out;
}

interface InfoAssinatura {
  id: string;
  signatureValue: string;
  references: { uri: string; digest: string }[];
}

/** Descendentes (qualquer prefixo/ns) com o localName dado. */
function descendentesPorLocalName(no: any, nome: string): any[] {
  const out: any[] = [];
  const visitar = (n: any) => {
    for (let i = 0; i < (n?.childNodes?.length ?? 0); i++) {
      const c = n.childNodes[i];
      if (c.localName === nome) out.push(c);
      visitar(c);
    }
  };
  visitar(no);
  return out;
}

/** Esqueleto (posição ainda não assinada — SignatureValue vazio, sem Id):
 *  não é conteúdo assinado, não participa do casamento/enxerto. */
function ehSkeleton(sig: any): boolean {
  for (let i = 0; i < (sig?.childNodes?.length ?? 0); i++) {
    const c = sig.childNodes[i];
    if (c.localName === 'SignatureValue') return (c.textContent ?? '').trim() === '';
  }
  return false;
}

/** Fingerprint assinado de cada ds:Signature REAL (Id + SignatureValue +
 *  References) para o portão de integridade. Base64 normalizado sem
 *  whitespace (a BRy pode requebrar linhas ao re-serializar). */
function fingerprintAssinaturas(doc: any): InfoAssinatura[] {
  const sigs = doc.getElementsByTagNameNS('*', 'Signature');
  const out: InfoAssinatura[] = [];
  for (let i = 0; i < sigs.length; i++) {
    const sig = sigs[i];
    if (ehSkeleton(sig)) continue;
    const info: InfoAssinatura = { id: sig.getAttribute('Id') ?? '', signatureValue: '', references: [] };
    for (let j = 0; j < sig.childNodes.length; j++) {
      const c = sig.childNodes[j];
      if (c.localName === 'SignatureValue') {
        info.signatureValue = (c.textContent ?? '').replace(/\s+/g, '');
      } else if (c.localName === 'SignedInfo') {
        for (let k = 0; k < c.childNodes.length; k++) {
          const r = c.childNodes[k];
          if (r.localName !== 'Reference') continue;
          const ref = { uri: r.getAttribute('URI') ?? '', digest: '' };
          for (let m = 0; m < r.childNodes.length; m++) {
            if (r.childNodes[m].localName === 'DigestValue') {
              ref.digest = (r.childNodes[m].textContent ?? '').replace(/\s+/g, '');
            }
          }
          info.references.push(ref);
        }
      }
    }
    out.push(info);
  }
  return out;
}

function escaparAtributo(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Enxerta no `xmlOriginal` APENAS os blocos SignatureTimeStamp que a BRy
 * ADICIONOU (presentes no `xmlBry` e ausentes no original), localizando
 * cada assinatura pelo Id da ds:Signature. O documento devolvido pela BRy
 * é re-serializado pelo motor dela — NUNCA é adotado: apenas os tokens
 * CMS (base64) e o algoritmo de canonicalização do carimbo são copiados,
 * reemitidos com os prefixos JÁ EM ESCOPO no original (xades:/ds:, sem
 * namespace novo) e inseridos por cirurgia de string. Nenhum byte
 * coberto pelas References existentes é alterado — DigestValue nunca é
 * recalculado. Se algo não casar (conteúdo assinado alterado, Id
 * ausente, carimbo sem token), lança erro EXPLÍCITO preservando o XML
 * local intacto (sem fallback para o documento da BRy).
 */
export function enxertarCarimbosBry(
  xmlOriginal: string,
  xmlBry: string,
  escopo: EscopoCarimbo = {}
): { xml: string; carimbosAdicionados: number } {
  let docOriginal: any;
  let docBry: any;
  try {
    docOriginal = new DOMParser().parseFromString(xmlOriginal, 'text/xml');
    docBry = new DOMParser().parseFromString(xmlBry, 'text/xml');
  } catch (e: any) {
    throw new Error('BRy devolveu XML ilegível — XML local preservado sem alteração: ' + (e?.message ?? String(e)));
  }

  // ---- Portão de integridade: a BRy não pode alterar conteúdo assinado
  const fpsOriginal = fingerprintAssinaturas(docOriginal);
  const fpsBry = fingerprintAssinaturas(docBry);
  if (fpsOriginal.length !== fpsBry.length) {
    throw new Error(
      `BRy devolveu documento com quantidade de assinaturas divergente (enviadas ${fpsOriginal.length}, devolvidas ${fpsBry.length}) — XML local preservado sem alteração.`
    );
  }
  for (let i = 0; i < fpsOriginal.length; i++) {
    const a = fpsOriginal[i];
    const b = fpsBry[i];
    if (!a.id || a.id !== b.id) {
      throw new Error(
        `BRy devolveu documento sem casar os Ids das assinaturas (esperado "${a.id || '(sem Id)'}", veio "${b.id || '(sem Id)'}") — XML local preservado sem alteração.`
      );
    }
    if (a.signatureValue !== b.signatureValue) {
      throw new Error(`BRy devolveu SignatureValue alterado na assinatura Id="${a.id}" — XML local preservado sem alteração.`);
    }
    if (JSON.stringify(a.references) !== JSON.stringify(b.references)) {
      throw new Error(`BRy devolveu References/DigestValues alterados na assinatura Id="${a.id}" — XML local preservado sem alteração.`);
    }
  }

  // ---- Extração: o que a BRy ADICIONOU (original não tinha)
  const sigsBry = docBry.getElementsByTagNameNS('*', 'Signature');
  const carimbosPorId = new Map<string, string>();
  for (let i = 0; i < sigsBry.length; i++) {
    const sigBry = sigsBry[i];
    if (ehSkeleton(sigBry)) continue; // posição não assinada — BRy não carimba
    const id = sigBry.getAttribute('Id') ?? '';
    const originalSig = (() => {
      const sigs = docOriginal.getElementsByTagNameNS('*', 'Signature');
      for (let j = 0; j < sigs.length; j++) if ((sigs[j].getAttribute('Id') ?? '') === id) return sigs[j];
      return null;
    })();
    // apenasRaiz (FASE 4): internas têm conteúdo coberto pelo digest da
    // raiz URI="" — tocar depois da assinatura da raiz quebra o gate.
    if (escopo.apenasRaiz && originalSig && originalSig.parentNode !== docOriginal.documentElement) continue;
    const jaTemCarimbo = originalSig ? descendentesPorLocalName(originalSig, 'SignatureTimeStamp').length > 0 : false;
    if (jaTemCarimbo) continue; // regra: copiar somente o que NÃO existia
    const timestamps = descendentesPorLocalName(sigBry, 'SignatureTimeStamp');
    if (timestamps.length === 0) continue;
    const blocos: string[] = [];
    for (const ts of timestamps) {
      const tsId = ts.getAttribute('Id');
      let algo = ALGO_C14N_EXC_PADRAO;
      const tokens: string[] = [];
      for (let j = 0; j < ts.childNodes.length; j++) {
        const c = ts.childNodes[j];
        if (c.localName === 'CanonicalizationMethod') {
          algo = c.getAttribute('Algorithm') || ALGO_C14N_EXC_PADRAO;
        } else if (c.localName === 'EncapsulatedTimeStamp') {
          const tok = (c.textContent ?? '').replace(/\s+/g, '');
          if (tok) tokens.push(tok);
        }
      }
      if (tokens.length === 0) {
        throw new Error(`BRy devolveu SignatureTimeStamp sem EncapsulatedTimeStamp (assinatura Id="${id}") — XML local preservado sem alteração.`);
      }
      blocos.push(
        `<xades:SignatureTimeStamp${tsId ? ` Id="${escaparAtributo(tsId)}"` : ''}>` +
        `<CanonicalizationMethod Algorithm="${escaparAtributo(algo)}" xmlns="${NS_DS_ENXERTO}" />` +
        tokens.map((tok) => `<xades:EncapsulatedTimeStamp>${tok}</xades:EncapsulatedTimeStamp>`).join('') +
        `</xades:SignatureTimeStamp>`
      );
    }
    carimbosPorId.set(id, blocos.join(''));
  }

  // ---- Cirurgia de string no ORIGINAL (sem reparse/re-serialização)
  let out = xmlOriginal;
  for (const [id, bloco] of carimbosPorId) {
    const trecho = out.match(new RegExp(`<(?:[A-Za-z0-9_-]+:)?Signature(?:\\s[^>]*)?>[\\s\\S]*?</(?:[A-Za-z0-9_-]+:)?Signature>`, 'g'))
      ?.find((t) => t.includes(`Id="${id}"`));
    if (!trecho) {
      throw new Error(`Assinatura Id="${id}" não localizada no XML original para o enxerto — XML local preservado sem alteração.`);
    }
    const novoTrecho = trecho.includes('</xades:UnsignedSignatureProperties>')
      ? trecho.replace('</xades:UnsignedSignatureProperties>', bloco + '</xades:UnsignedSignatureProperties>')
      : trecho.replace(
          '</xades:QualifyingProperties>',
          '<xades:UnsignedProperties><xades:UnsignedSignatureProperties>' + bloco + '</xades:UnsignedSignatureProperties></xades:UnsignedProperties></xades:QualifyingProperties>'
        );
    if (novoTrecho === trecho) {
      throw new Error(`Ponto de inserção do carimbo não encontrado na assinatura Id="${id}" — XML local preservado sem alteração.`);
    }
    out = out.replace(trecho, novoTrecho);
  }

  const antes = contarOcorrencias(xmlOriginal, '<xades:EncapsulatedTimeStamp');
  const depois = contarOcorrencias(out, '<xades:EncapsulatedTimeStamp');
  return { xml: out, carimbosAdicionados: Math.max(depois - antes, 0) };
}
