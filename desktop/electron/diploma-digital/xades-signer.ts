// ============================================================
// ASSINADOR XADES-BES — Diploma Digital MEC (XMLDSig + XAdES)
// ============================================================
// Assinatura REAL (RSA-SHA256 + C14N) sobre os artefatos XML:
//  - Reference #1: documento inteiro (transform enveloped + C14N)
//  - Reference #2: xades:SignedProperties (XAdES-BES: SigningTime,
//    SigningCertificate com digest SHA-256 do certificado)
//  - KeyInfo: certificado X509 completo (verificável por terceiros)
//
// ESQUELETO = ds:Signature com SignatureValue VAZIO (presente no XML
// gerado para satisfazer o XSD). Este assinador substitui o primeiro
// esqueleto pela assinatura real, NA MESMA POSIÇÃO (pai correto
// preservado — as assinaturas nunca se aninham nos leiautes do MEC).
// `assinarTodos…` assina todas as posições da EMISSORA (Histórico: 1;
// DA: 2). No Diploma FINAL as posições da REGISTRADORA permanecem
// esqueleto — quem assina é a registradora, jamais a emissora.
//
// A1 (.pfx/PEM): node-forge → assinatura Node puro, verificável por
// round-trip com xml-crypto (checkSignature — motor independente).
// A3 (token): handler usa a infra PowerShell SignedXml existente
// (XMLDSig enveloped real com o token ICP-Brasil); camada XAdES no A3
// é pendência de conformidade documentada em DIPLOMA_DIGITAL.md.
// Política (XAdES-EPES): incluir SOMENTE quando a IES confirmar o
// identificador oficial vigente na IN-05 (BES enquanto isso — sem
// inventar OID).
import { createHash } from 'node:crypto';
import { C14nCanonicalization, findAncestorNs } from 'xml-crypto';
import { DOMParser } from '@xmldom/xmldom';
import { NS_DS } from './xml-utils';

const ALGO_C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const ALGO_ENV = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const ALGO_RSA = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const ALGO_SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const NS_XADES = 'http://uri.etsi.org/01903/v1.3.2#';
const TYPE_SIGNED_PROPERTIES = 'http://uri.etsi.org/01903#SignedProperties';

export interface OpcoesAssinaturaXades {
  signatureId: string;
  chavePem: string;
  certPem: string;
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

function qualifyingProperties(
  certDer: Buffer,
  issuerSerial: { issuerName: string; serialNumber: string },
  signatureId: string,
  agora: Date
): string {
  const certDigest = b64(createHash('sha256').update(certDer).digest());
  const spId = `${signatureId}-SP`;
  const signingTime = agora.toISOString().slice(0, 19) + 'Z';
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
    `<X509IssuerName>${issuerSerial.issuerName}</X509IssuerName>` +
    `<X509SerialNumber>${issuerSerial.serialNumber}</X509SerialNumber>` +
    '</xades:IssuerSerial>' +
    '</xades:Cert>' +
    '</xades:SigningCertificate>' +
    '</xades:SignedSignatureProperties>' +
    '</xades:SignedProperties>' +
    '</xades:QualifyingProperties>'
  );
}

/**
 * Substitui o PRIMEIRO esqueleto pela assinatura XAdES-BES real
 * (A1/PEM), na mesma posição. O digest do documento é computado sobre
 * o doc SEM a assinatura alvo e COM as demais — mesmo comportamento do
 * transform enveloped do validador (que remove apenas a própria).
 */
export function assinarProximoEsqueleto(xml: string, opts: OpcoesAssinaturaXades): string {
  const forge = require('node-forge');
  const alvo = trechosAssinatura(xml).find((t) => t.esqueleto);
  if (!alvo) throw new Error('Artefato sem posição de assinatura pendente (esqueleto ausente)');
  const fim = alvo.inicio + alvo.texto.length;
  const docBase = xml.slice(0, alvo.inicio) + xml.slice(fim);

  // certificado: DER (digest XAdES) + IssuerSerial + PEM limpo
  const certForge = forge.pki.certificateFromPem(opts.certPem);
  const certDer = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(certForge)).getBytes(), 'binary');
  const issuerName = (certForge.issuer as any).attributes
    .map((a: any) => `${a.shortName}=${a.value}`)
    .join(',');
  const certB64 = opts.certPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');

  const agora = new Date();
  const spId = `${opts.signatureId}-SP`;
  const qp = qualifyingProperties(certDer, { issuerName, serialNumber: certForge.serialNumber }, opts.signatureId, agora);

  // ---- digest #1: doc sem a assinatura alvo (demais permanecem)
  const c14nDoc = new C14nCanonicalization().process(parseDoc(docBase).documentElement as any, {} as any);
  const digestDoc = b64(createHash('sha256').update(Buffer.from(c14nDoc, 'utf8')).digest());

  const signedInfo =
    `<ds:SignedInfo xmlns:ds="${NS_DS}">` +
    `<ds:CanonicalizationMethod Algorithm="${ALGO_C14N}"></ds:CanonicalizationMethod>` +
    `<ds:SignatureMethod Algorithm="${ALGO_RSA}"></ds:SignatureMethod>` +
    `<ds:Reference URI="">` +
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

  // ---- digest #2: SignedProperties no contexto (ancestorNamespaces —
  // mesma técnica do validador)
  const docPh = parseDoc(inserirPh(placeholder));
  const spNode = docPh.getElementsByTagNameNS('*', 'SignedProperties')[0];
  if (!spNode) throw new Error('SignedProperties não montado');
  const ancestorSp = findAncestorNs(docPh as any, "//*[local-name()='SignedProperties']");
  const c14nSp = new C14nCanonicalization().process(spNode as any, { ancestorNamespaces: ancestorSp });
  const digestSp = b64(createHash('sha256').update(Buffer.from(c14nSp, 'utf8')).digest());

  const signedInfoFinal = signedInfo.replace('<ds:DigestValue></ds:DigestValue>', `<ds:DigestValue>${digestSp}</ds:DigestValue>`);
  const placeholderFinal = placeholder.replace(signedInfo, signedInfoFinal);

  // ---- assina o C14N do SignedInfo NO CONTEXTO
  const docPh2 = parseDoc(inserirPh(placeholderFinal));
  const siNode = docPh2.getElementsByTagNameNS('*', 'SignedInfo')[0];
  if (!siNode) throw new Error('SignedInfo não montado');
  const ancestorSi = findAncestorNs(docPh2 as any, "//*[local-name()='SignedInfo']");
  const c14nSi = new C14nCanonicalization().process(siNode as any, { ancestorNamespaces: ancestorSi });

  const md = forge.md.sha256.create();
  md.update(c14nSi, 'utf8');
  const chave = forge.pki.privateKeyFromPem(opts.chavePem);
  const signatureValue = forge.util.encode64(chave.sign(md));

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
export function assinarTodosEsqueletos(xml: string, opts: { signatureIdBase: string; chavePem: string; certPem: string }): string {
  let out = xml;
  let i = 0;
  while (contarEsqueletos(out) > 0) {
    out = assinarProximoEsqueleto(out, {
      signatureId: `${opts.signatureIdBase}-${i}`,
      chavePem: opts.chavePem,
      certPem: opts.certPem,
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
