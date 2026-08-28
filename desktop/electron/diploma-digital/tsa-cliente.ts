// ============================================================
// CLIENTE TSA — RFC 3161 (Time-Stamp Protocol) p/ XAdES-T
// ============================================================
// Carimbo do tempo criptográfico exigido pela política de assinatura
// do Diploma Digital MEC (IN Sesu 1/2020, anexos v1.05): o token da
// TSA (EncapsulatedTimeStamp) atesta a existência do SignatureValue
// na hora emitida, por TERCEIRO auditado — jamais auto-carimbado.
//
// Protocolo: POST HTTP(S) "application/timestamp-query" (DER) →
// "application/timestamp-reply" (DER). Módulo PURO (fetch global),
// funções de montagem/validação exportadas p/ teste sem rede.
//
import { createHash, randomBytes } from 'node:crypto';

export interface ConfigTsa {
  url: string;
  usuario?: string | null;
  senha?: string | null;
}

export interface CarimboTempo {
  /** Token completo (TimeStampResp DER) — vai no EncapsulatedTimeStamp. */
  token: Buffer;
  /** Hora gerada pela TSA (GeneralizedTime → ISO). */
  genTime?: string;
  nonce: Buffer;
}

const OID_SHA256 = '2.16.840.1.101.3.4.2.1';

function forge() {
  // require tardiamente para manter o módulo importável em testes
  return require('node-forge');
}

/**
 * Monta a TimeStampReq (DER) — RFC 3161 §3.4:
 * SEQUENCE { version=1, messageImprint{SHA-256, digest}, nonce[1],
 *            certReq[2]=TRUE }
 */
export function montarRequisicao(digest: Buffer): { der: Buffer; nonce: Buffer } {
  const { asn1 } = forge();
  const nonce = randomBytes(16);
  const req = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    // version INTEGER 1
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false,
      asn1.integerToDer(1).getBytes()),
    // messageImprint SEQUENCE { AlgorithmIdentifier{SHA-256}, OCTET STRING }
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false,
          asn1.oidToDer(OID_SHA256).getBytes()),
      ]),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false,
        digest.toString('binary')),
    ]),
    // nonce [1] IMPLICIT INTEGER
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 1, false, nonce.toString('binary')),
    // certReq [2] IMPLICIT BOOLEAN TRUE (token inclui os certificados da TSA)
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 2, false, '\u0001'),
  ]);
  const der = Buffer.from(asn1.toDer(req).getBytes(), 'binary');
  return { der, nonce };
}

/** Percorre a árvore ASN.1 em pré-ordem. */
function percorrer(no: any, visita: (n: any) => boolean): void {
  if (!no || !visita(no)) return;
  if (no.value && Array.isArray(no.value)) for (const f of no.value) percorrer(f, visita);
}

/** Extrai PKIStatus (INTEGER, 1º campo do PKIStatusInfo). 0=granted, 1=grantedWithMods. */
function statusDaResposta(resp: any): number | null {
  const raiz = resp; // TimeStampResp SEQUENCE
  if (!raiz?.value?.length) return null;
  const statusInfo = raiz.value[0]; // PKIStatusInfo SEQUENCE
  const statusNo = statusInfo?.value?.[0];
  if (statusNo?.type !== 2) return null; // INTEGER
  try {
    return parseInt(forge().asn1.derToInteger(statusNo.value).toString(), 10);
  } catch {
    return null;
  }
}

/** Extrai genTime (GeneralizedTime, tag 24) e nonce [5] do TSTInfo. */
function dadosDoToken(token: any): { genTime?: string; nonce?: Buffer } {
  const { asn1 } = forge();
  let genTime: string | undefined;
  let nonce: Buffer | undefined;
  percorrer(token, (n) => {
    if (genTime && nonce) return false;
    if (n.type === 24 && typeof n.value === 'string') {
      // GeneralizedTime AAAAMMDDHHMMSSZ
      const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(n.value);
      if (m) genTime = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
      return genTime === undefined;
    }
    if (n.tagClass === asn1.Class.CONTEXT_SPECIFIC && n.type === 5 && n.constructed) {
      const inteiro = n.value?.[0];
      if (inteiro?.type === 2) {
        try { nonce = Buffer.from(asn1.integerToDer(asn1.derToInteger(inteiro.value)).getBytes(), 'binary'); } catch { /* ignora */ }
      }
      return false;
    }
    return true;
  });
  return { genTime, nonce };
}

/**
 * Valida a TimeStampResp (status granted + nonce) e devolve SOMENTE o
 * TimeStampToken (CMS ContentInfo, RFC 3161) — é o que o XAdES exige no
 * EncapsulatedTimeStamp (a resposta completa carrega o PKIStatusInfo,
 * que não faz parte do token).
 */
export function validarResposta(derResp: Buffer, nonceEsperado: Buffer): CarimboTempo {
  const { asn1 } = forge();
  let resp: any;
  try {
    resp = asn1.fromDer(derResp.toString('binary'));
  } catch {
    throw new Error('TSA devolveu resposta DER ilegível.');
  }
  const status = statusDaResposta(resp);
  if (status !== 0 && status !== 1) {
    throw new Error(`TSA recusou o carimbo (PKIStatus ${status ?? 'desconhecido'}).`);
  }
  const token = resp.value?.[1];
  if (!token) throw new Error('TSA devolveu status OK sem o token de carimbo.');
  const { genTime, nonce } = dadosDoToken(token);
  if (nonce && !nonce.equals(nonceEsperado)) {
    throw new Error('Nonce do carimbo não confere com a requisição (resposta trocada?).');
  }
  const derToken = Buffer.from(asn1.toDer(token).getBytes(), 'binary');
  return { token: derToken, genTime, nonce: nonceEsperado };
}

/** Solicita um carimbo RFC 3161 do digest. @digest = 32 bytes SHA-256. */
export async function carimbarDigest(cfg: ConfigTsa, digest: Buffer, timeoutMs = 20000): Promise<CarimboTempo> {
  if (!/^https?:\/\//i.test(cfg.url ?? '')) throw new Error('URL do TSA inválida.');
  const { der, nonce } = montarRequisicao(digest);
  const headers: Record<string, string> = {
    'Content-Type': 'application/timestamp-query',
    Accept: 'application/timestamp-reply',
  };
  if (cfg.usuario && cfg.senha) {
    headers.Authorization = 'Basic ' + Buffer.from(`${cfg.usuario}:${cfg.senha}`).toString('base64');
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(cfg.url, { method: 'POST', headers, body: new Uint8Array(der), signal: ctl.signal });
    if (!res.ok) throw new Error(`TSA respondeu HTTP ${res.status}.`);
    const ctype = res.headers.get('content-type') ?? '';
    if (!ctype.includes('timestamp-reply')) {
      throw new Error(`TSA devolveu content-type inesperado ("${ctype}").`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return validarResposta(buf, nonce);
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('TSA não respondeu no tempo (timeout).');
    throw e instanceof Error ? e : new Error(String(e));
  } finally {
    clearTimeout(t);
  }
}

/** SHA-256 do dado a carimbar (puro — usado pelo assinador XAdES-T). */
export function sha256(buf: Buffer): Buffer {
  return createHash('sha256').update(buf).digest();
}
