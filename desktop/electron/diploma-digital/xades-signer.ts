// ============================================================
// ASSINADOR XADES-BES — Diploma Digital MEC (XMLDSig + XAdES)
// ============================================================
// Assinatura REAL (RSA-SHA256 + C14N) sobre os artefatos XML:
//  - Reference #1: elemento ANCESTRAL da assinatura — quando ele tem
//    @id (ex.: DadosDiploma id="Dip{44}") a Reference é URI="#Dip{44}"
//    e o digest cobre a SUBÁRVORE (enveloped + C14N); sem @id (nível
//    raiz), URI="" cobre o documento inteiro. A referência por @id é
//    o que mantém a assinatura da EMISSORA válida no Diploma final,
//    onde o DadosDiploma é transplantado byte-idêntito da DA, e o que
//    impede que a 2ª assinatura da DA (raiz) invalide a 1ª (interna).
//  - Reference #2: xades:SignedProperties (XAdES-BES: SigningTime,
//    SigningCertificate com digest SHA-256 do certificado)
//  - KeyInfo: certificado X509 completo (verificável por terceiros)
//
// ESQUELETO = ds:Signature com SignatureValue VAZIO (presente no XML
// gerado para satisfazer o XSD). Este assinador substitui o primeiro
// esqueleto pela assinatura real, NA MESMA POSIÇÃO (pai correto
// preservado — as assinaturas nunca se aninham nos leiautes do MEC).
// `assinarTodos…` assina todas as posições da EMISSORA (Histórico: 1;
// DA: 2 — SEMPRE em ordem de ocorrência, interna antes da raiz). No
// Diploma FINAL as posições da REGISTRADORA permanecem esqueleto —
// quem assina é a registradora, jamais a emissora.
//
// CONFORMIDADE X509 (XAdES/XMLDSig): X509SerialNumber é xs:integer →
// serial DECIMAL (node-forge devolve hex; convertemos). X509IssuerName
// segue RFC2253 (ordem INVERSA do ASN.1 + escaping).
//
// A1 (.pfx/PEM): node-forge → assinatura Node puro, verificável por
// round-trip com xml-crypto (checkSignature — motor independente).
// A3 (token): o digest SHA-256 do SignedInfo é assinado DENTRO do
// token via SignHash bruto (PowerShell/assinarHashA3) — mesmo
// resultado criptográfico do A1; a chave nunca sai do hardware.
// Política (XAdES-EPES): opcional (`politica`) — exige identificador
// e digest SHA-256 do documento oficial da política (IN-05); sem
// esses dados confirmados NÃO inventar OID (fica BES).
import { createHash } from 'node:crypto';
import { C14nCanonicalization, findAncestorNs } from 'xml-crypto';
import { DOMParser } from '@xmldom/xmldom';
import { NS_DS, escapeXml } from './xml-utils';

const ALGO_C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const ALGO_ENV = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';const ALGO_RSA = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const ALGO_SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const NS_XADES = 'http://uri.etsi.org/01903/v1.3.2#';
const TYPE_SIGNED_PROPERTIES = 'http://uri.etsi.org/01903#SignedProperties';

/** XAdES-EPES opcional: identificador + digest SHA-256 do documento
 *  da política (o SigPolicyHash é OBRIGATÓRIO no EPES — sem o digest
 *  do documento oficial a política não pode ser incluída). */
export interface PoliticaXades {
  /** Identificador oficial (ex.: URI ou "urn:oid:…"). */
  identificador: string;
  /** Digest SHA-256 (base64) do documento da política. */
  digestBase64: string;
  descricao?: string;
}

export interface OpcoesAssinaturaXades {
  signatureId: string;
  /** A1: chave PEM da IES (assinatura em Node puro). */
  chavePem?: string;
  /** Certificado público PEM (KeyInfo/XAdES) — obrigatório em A1 e A3. */
  certPem: string;
  /** A3: thumbprint do certificado no Windows Store — o digest é assinado
   *  DENTRO do token (SignHash bruto); a chave nunca sai do hardware. */
  thumbprintA3?: string;
  /** XAdES-EPES: omitir = BES (padrão). */
  politica?: PoliticaXades;
}

function b64(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64');
}

function parseDoc(xml: string): any {
  return new DOMParser().parseFromString(xml, 'text/xml');
}

/**
 * Trechos de assinatura no XML (match lazy — nunca atravessa o
 * fechamento de uma assinatura; os leiautes MEC não aninham
 * ds:Signature dentro de ds:Signature). Esqueleto = SignatureValue
 * vazio (posição ainda não assinada).
 */
function trechosAssinatura(xml: string): { inicio: number; texto: string; esqueleto: boolean }[] {
  const out: { inicio: number; texto: string; esqueleto: boolean }[] = [];
  for (const m of xml.matchAll(/<ds:Signature[^>]*>[\s\S]*?<\/ds:Signature>/g)) {
    const texto = m[0];
    out.push({ inicio: m.index ?? 0, texto, esqueleto: texto.includes('<ds:SignatureValue></ds:SignatureValue>') });
  }
  return out;
}

/** Nó do primeiro esqueleto (Signature com SignatureValue vazio) no doc. */
function acharNoSkeleton(doc: any): any {
  const assinaturas = doc.getElementsByTagNameNS('*', 'Signature');
  for (let i = 0; i < assinaturas.length; i++) {
    const sig = assinaturas[i];
    for (let j = 0; j < sig.childNodes.length; j++) {
      const c = sig.childNodes[j];
      if (c.localName === 'SignatureValue' && (c.textContent ?? '') === '') return sig;
    }
  }
  return null;
}

function attrId(el: any): string | null {
  if (!el?.getAttributeNode) return null;
  const a = el.getAttributeNode('id') ?? el.getAttributeNode('Id') ?? el.getAttributeNode('ID');
  return a?.value ?? null;
}

/** Elemento (por local-name, qualquer ns) cujo atributo Id/id tem o valor
 *  dado — seleção POR ID ÚNICO, nunca por ordem de documento (com 2+
 *  assinaturas no artefato, `[0]` pegaria a assinatura errada). */
function acharPorIdLocal(doc: any, tagLocal: string, id: string): any {
  const els = doc.getElementsByTagNameNS('*', tagLocal);
  for (let i = 0; i < els.length; i++) {
    if (attrId(els[i]) === id) return els[i];
  }
  return null;
}

/** Filho direto do nó com o local-name dado. */
function filhoLocal(node: any, local: string): any {
  for (let i = 0; i < node.childNodes.length; i++) {
    if (node.childNodes[i].localName === local) return node.childNodes[i];
  }
  return null;
}

/** Elemento (por tag) cujo atributo id tem o valor dado. */
function acharElementoPorId(doc: any, tag: string, id: string): any {
  const els = doc.getElementsByTagName(tag);
  for (let i = 0; i < els.length; i++) {
    if (attrId(els[i]) === id) return els[i];
  }
  return null;
}

/** Escapa valor de DN conforme RFC2253 (especial ,+"\<>; e bordas). */
function escaparRfc2253(v: string): string {
  let out = '';
  for (const ch of v) {
    if (',+"\\<>;'.includes(ch)) out += '\\' + ch;
    else out += ch;
  }
  if (out.startsWith('#') || out.startsWith(' ')) out = '\\' + out[0] + out.slice(1);
  if (out.endsWith(' ')) out = out.slice(0, -1) + '\\ ';
  return out;
}

/** DN do issuer em RFC2253: ordem INVERSA da sequência ASN.1,
 *  atributos "TYPE=valor" separados por vírgula, valores escapados. */
function dnRfc2253(atributos: any[]): string {
  return atributos
    .slice()
    .reverse()
    .map((a) => `${a.shortName ?? a.name ?? a.type}=${escaparRfc2253(String(a.value))}`)
    .join(',');
}

/** Serial do certificado em DECIMAL (XMLDSig X509SerialNumber é
 *  xs:integer; o node-forge devolve hexadecimal). */
function serialDecimal(hex: string): string {
  return BigInt('0x' + hex).toString();
}

function qualifyingProperties(
  certDer: Buffer,
  issuerSerial: { issuerName: string; serialNumber: string },
  signatureId: string,
  agora: Date,
  politica?: PoliticaXades
): string {
  const certDigest = b64(createHash('sha256').update(certDer).digest());
  const spId = `${signatureId}-SP`;
  const signingTime = agora.toISOString().slice(0, 19) + 'Z';
  // XAdES 1.3.2: SignedSignatureProperties = SigningTime,
  // SigningCertificate?, SignaturePolicyIdentifier?, … (nesta ordem).
  const policyXml = politica
    ? (
        '<xades:SignaturePolicyIdentifier>' +
        '<xades:SignaturePolicyId>' +
        '<xades:SigPolicyId>' +
        `<xades:Identifier>${escapeXml(politica.identificador)}</xades:Identifier>` +
        (politica.descricao ? `<xades:Description>${escapeXml(politica.descricao)}</xades:Description>` : '') +
        '</xades:SigPolicyId>' +
        '<xades:SigPolicyHash>' +
        `<DigestMethod Algorithm="${ALGO_SHA256}"></DigestMethod>` +
        `<DigestValue>${escapeXml(politica.digestBase64)}</DigestValue>` +
        '</xades:SigPolicyHash>' +
        '</xades:SignaturePolicyId>' +
        '</xades:SignaturePolicyIdentifier>'
      )
    : '';
  return (
    `<xades:QualifyingProperties xmlns:xades="${NS_XADES}" Target="#${signatureId}">` +
    `<xades:SignedProperties Id="${spId}">` +
    '<xades:SignedSignatureProperties>' +
    `<xades:SigningTime>${signingTime}</xades:SigningTime>` +
    '<xades:SigningCertificate>' +
    '<xades:Cert>' +
    '<xades:CertDigest>' +
    `<DigestMethod Algorithm="${ALGO_SHA256}"></DigestMethod>` +
    `<DigestValue>${certDigest}</DigestValue>` +
    '</xades:CertDigest>' +
    '<xades:IssuerSerial>' +
    `<X509IssuerName>${escapeXml(issuerSerial.issuerName)}</X509IssuerName>` +
    `<X509SerialNumber>${escapeXml(issuerSerial.serialNumber)}</X509SerialNumber>` +
    '</xades:IssuerSerial>' +
    '</xades:Cert>' +
    '</xades:SigningCertificate>' +
    policyXml +
    '</xades:SignedSignatureProperties>' +
    '</xades:SignedProperties>' +
    '</xades:QualifyingProperties>'
  );
}

/**
 * Substitui o PRIMEIRO esqueleto pela assinatura XAdES-BES real, na
 * mesma posição. A Reference #1 aponta para o ANCESTRAL do esqueleto
 * quando ele tem @id (ex.: DadosDiploma id="Dip{44}" → URI="#Dip{44}",
 * digest sobre a subárvore SEM a própria assinatura — semântica do
 * transform enveloped); sem @id, URI="" (documento inteiro menos a
 * própria). Assinaturas irmãs/externas permanecem no digest, como no
 * validador.
 */
export async function assinarProximoEsqueleto(xml: string, opts: OpcoesAssinaturaXades): Promise<string> {
  const forge = require('node-forge');
  const alvo = trechosAssinatura(xml).find((t) => t.esqueleto);
  if (!alvo) throw new Error('Artefato sem posição de assinatura pendente (esqueleto ausente)');
  const fim = alvo.inicio + alvo.texto.length;
  const docBase = xml.slice(0, alvo.inicio) + xml.slice(fim);

  // Ancestral do esqueleto e seu @id → URI da Reference #1
  const docSkeleton = parseDoc(xml);
  const noSkeleton = acharNoSkeleton(docSkeleton);
  const ancestral = noSkeleton?.parentNode ?? null;
  const refId = ancestral?.nodeType === 1 ? attrId(ancestral) : null;

  // certificado: DER (digest XAdES) + IssuerSerial RFC2253 + PEM limpo
  const certForge = forge.pki.certificateFromPem(opts.certPem);
  const certDer = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(certForge)).getBytes(), 'binary');
  const issuerName = dnRfc2253((certForge.issuer as any).attributes);
  const serial = serialDecimal(certForge.serialNumber);
  const certB64 = opts.certPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');

  const agora = new Date();
  const spId = `${opts.signatureId}-SP`;
  const qp = qualifyingProperties(certDer, { issuerName, serialNumber: serial }, opts.signatureId, agora, opts.politica);

  // ---- digest #1: ancestral com @id → subárvore (com namespaces
  // herdados); sem @id → documento inteiro. A própria assinatura já
  // foi removida (docBase); demais permanecem — como no enveloped.
  let digestDoc: string;
  if (refId) {
    const docBaseParsed = parseDoc(docBase);
    const alvoNode = acharElementoPorId(docBaseParsed, ancestral.tagName, refId);
    if (!alvoNode) throw new Error(`Elemento com id="${refId}" não encontrado para a Reference`);
    const ancestorNs = findAncestorNs(docBaseParsed as any, `//*[@id='${refId}']`);
    const c14nAlvo = new C14nCanonicalization().process(alvoNode as any, { ancestorNamespaces: ancestorNs });
    digestDoc = b64(createHash('sha256').update(Buffer.from(c14nAlvo, 'utf8')).digest());
  } else {
    const c14nDoc = new C14nCanonicalization().process(parseDoc(docBase).documentElement as any, {} as any);
    digestDoc = b64(createHash('sha256').update(Buffer.from(c14nDoc, 'utf8')).digest());
  }

  const signedInfo =
    `<ds:SignedInfo xmlns:ds="${NS_DS}">` +
    `<ds:CanonicalizationMethod Algorithm="${ALGO_C14N}"></ds:CanonicalizationMethod>` +
    `<ds:SignatureMethod Algorithm="${ALGO_RSA}"></ds:SignatureMethod>` +
    `<ds:Reference URI="${refId ? '#' + refId : ''}">` +
    `<ds:Transforms><ds:Transform Algorithm="${ALGO_ENV}"></ds:Transform><ds:Transform Algorithm="${ALGO_C14N}"></ds:Transform></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${ALGO_SHA256}"></ds:DigestMethod>` +
    `<ds:DigestValue>${digestDoc}</ds:DigestValue>` +
    `</ds:Reference>` +
    `<ds:Reference URI="#${spId}" Type="${TYPE_SIGNED_PROPERTIES}">` +
    `<ds:Transforms><ds:Transform Algorithm="${ALGO_C14N}"></ds:Transform></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${ALGO_SHA256}"></ds:DigestMethod>` +
    `<ds:DigestValue></ds:DigestValue>` +
    `</ds:Reference>` +
    `</ds:SignedInfo>`;

  const placeholder =
    `<ds:Signature xmlns:ds="${NS_DS}" Id="${opts.signatureId}">` +
    signedInfo +
    '<ds:SignatureValue></ds:SignatureValue>' +
    '<ds:KeyInfo><ds:X509Data>' +
    `<ds:X509Certificate>${certB64}</ds:X509Certificate>` +
    '</ds:X509Data></ds:KeyInfo>' +
    `<ds:Object Id="${opts.signatureId}-Obj">${qp}</ds:Object>` +
    '</ds:Signature>';

  const inserirPh = (assinaturaXml: string): string =>
    docBase.slice(0, alvo.inicio) + assinaturaXml + docBase.slice(alvo.inicio);

  // ---- digest #2: SignedProperties NO CONTEXTO do placeholder (por Id
  // único — o artefato já contém assinaturas anteriores) — ancestorNamespaces,
  // mesma técnica do validador
  const docPh = parseDoc(inserirPh(placeholder));
  const spNode = acharPorIdLocal(docPh, 'SignedProperties', spId);
  if (!spNode) throw new Error('SignedProperties não montado');
  const ancestorSp = findAncestorNs(docPh as any, "//*[local-name()='SignedProperties' and (@Id='" + spId + "' or @id='" + spId + "')]");
  const c14nSp = new C14nCanonicalization().process(spNode as any, { ancestorNamespaces: ancestorSp });
  const digestSp = b64(createHash('sha256').update(Buffer.from(c14nSp, 'utf8')).digest());

  const signedInfoFinal = signedInfo.replace('<ds:DigestValue></ds:DigestValue>', `<ds:DigestValue>${digestSp}</ds:DigestValue>`);
  const placeholderFinal = placeholder.replace(signedInfo, signedInfoFinal);

  // ---- assina o C14N do SignedInfo NO CONTEXTO (do placeholder, por Id)
  const docPh2 = parseDoc(inserirPh(placeholderFinal));
  const sigPh = acharPorIdLocal(docPh2, 'Signature', opts.signatureId);
  const siNode = sigPh ? filhoLocal(sigPh, 'SignedInfo') : null;
  if (!siNode) throw new Error('SignedInfo não montado');
  const ancestorSi = findAncestorNs(docPh2 as any, "//*[local-name()='SignedInfo' and ../@Id='" + opts.signatureId + "']");
  const c14nSi = new C14nCanonicalization().process(siNode as any, { ancestorNamespaces: ancestorSi });

  let signatureValue: string;
  if (opts.thumbprintA3) {
    // A3: digest SHA-256 do C14N assinado DENTRO do token (SignHash bruto,
    // PKCS#1 v1.5) — mesmo resultado criptográfico do caminho A1.
    const { assinarHashA3 } = await import('../ipc/assinatura');
    const digest = createHash('sha256').update(c14nSi, 'utf8').digest();
    const sig = await assinarHashA3(opts.thumbprintA3, digest);
    signatureValue = sig.toString('base64');
  } else {
    if (!opts.chavePem) throw new Error('Assinatura exige chavePem (A1) ou thumbprintA3 (A3)');
    const md = forge.md.sha256.create();
    md.update(c14nSi, 'utf8');
    const chave = forge.pki.privateKeyFromPem(opts.chavePem);
    signatureValue = forge.util.encode64(chave.sign(md));
  }

  const assinatura =
    `<ds:Signature xmlns:ds="${NS_DS}" Id="${opts.signatureId}">` +
    signedInfoFinal +
    `<ds:SignatureValue>${signatureValue}</ds:SignatureValue>` +
    '<ds:KeyInfo><ds:X509Data>' +
    `<ds:X509Certificate>${certB64}</ds:X509Certificate>` +
    '</ds:X509Data></ds:KeyInfo>' +
    `<ds:Object Id="${opts.signatureId}-Obj">${qp}</ds:Object>` +
    '</ds:Signature>';

  return inserirPh(assinatura);
}

/** Assina TODOS os esqueletos restantes (em ordem) com suffixos -0, -1… */
export async function assinarTodosEsqueletos(xml: string, opts: {
  signatureIdBase: string;
  chavePem?: string;
  certPem: string;
  thumbprintA3?: string;
  politica?: PoliticaXades;
}): Promise<string> {
  let out = xml;
  let i = 0;
  while (contarEsqueletos(out) > 0) {
    out = await assinarProximoEsqueleto(out, {
      signatureId: `${opts.signatureIdBase}-${i}`,
      chavePem: opts.chavePem,
      certPem: opts.certPem,
      thumbprintA3: opts.thumbprintA3,
      politica: opts.politica,
    });
    i++;
    if (i > 6) throw new Error('Loop de assinatura — estrutura inesperada');
  }
  return out;
}

/** Quantidade de esqueletos (posições) ainda sem assinatura real. */
export function contarEsqueletos(xml: string): number {
  return trechosAssinatura(xml).filter((t) => t.esqueleto).length;
}
