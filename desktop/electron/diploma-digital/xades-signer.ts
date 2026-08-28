// ============================================================
// ASSINADOR XADES — Diploma Digital MEC
// ============================================================
// Assinatura REAL (RSA-SHA256 + C14N) no padrão do MEC:
//  - Reference #1: elemento ANCESTRAL da assinatura com @id
//    (DadosDiploma→#Dip{44}, RegistroReq→#ReqDip{44}; sem id→URI="")
//  - Reference #2: xades:SignedProperties (SigningTime +
//    SigningCertificate digest SHA-256 + EPES PA-AD-RC v2.4)
//  - KeyInfo: X509SubjectName + X509Certificate completo
//  - Conformidade X509: serial DECIMAL, IssuerSerial .NET
//  - A1: node-forge. A3: SignHash bruto no token.
//  - Carimbo/LTV aplicados por etapas posteriores (UnsignedProperties).
import { createHash, randomBytes } from 'node:crypto';
import { C14nCanonicalization } from 'xml-crypto';
import { DOMParser } from '@xmldom/xmldom';
import { NS_DS, NS_XADES, escapeXml } from './xml-utils';

const ALGO_C14N_EXC = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const ALGO_ENV = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const ALGO_XPATH = 'http://www.w3.org/TR/1999/REC-xpath-19991116';
const ALGO_RSA = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const ALGO_SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const TYPE_SIGNED_PROPERTIES = 'http://uri.etsi.org/01903#SignedProperties';
const XPATH_SEM_ASSINATURAS =
  'not(ancestor-or-self::*[namespace-uri()=&quot;http://www.w3.org/2000/09/xmldsig#&quot; and local-name()=&quot;Signature&quot;])';

// ---- Política de assinatura (EPES): PA_AD_RC_v2_4 (ICP-Brasil) ----
export const POLITICA_ASSINATURA: PoliticaXades = {
  identificador: 'urn:oid:2.16.76.1.7.1.9.2.4',
  digestBase64: 'JMLUkTNofr0oLNIBbVn5FMnQ0QE/XoDOgSTHP5MJbd4=',
  spuri: 'http://politicas.icpbrasil.gov.br/PA_AD_RC_v2_4.xml',
};

export interface PoliticaXades {
  identificador: string;
  digestBase64: string;
  spuri?: string;
}

export interface OpcoesAssinaturaXades {
  signatureId?: string;
  chavePem?: string;
  certPem: string;
  thumbprintA3?: string;
  politica?: PoliticaXades | null;
}

export interface OpcoesAssinarTodos extends Omit<OpcoesAssinaturaXades, 'signatureId'> {
  carimbador?: (digest: Buffer) => Promise<{ token: Buffer; genTime?: string }>;
}

function b64(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64');
}

function parseDoc(xml: string): any {
  return new DOMParser().parseFromString(xml, 'text/xml');
}

export function trechosAssinatura(xml: string): { inicio: number; texto: string; esqueleto: boolean }[] {
  const out: { inicio: number; texto: string; esqueleto: boolean }[] = [];
  for (const m of xml.matchAll(/<(?:ds:)?Signature(?:\s[^>]*)?>[\s\S]*?<\/(?:ds:)?Signature>/g)) {
    const texto = m[0];
    out.push({
      inicio: m.index ?? 0,
      texto,
      esqueleto: /<(?:ds:)?SignatureValue\s*\/>|<(?:ds:)?SignatureValue><\/(?:ds:)?SignatureValue>/.test(texto),
    });
  }
  return out;
}

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

function acharElementoPorId(doc: any, tag: string, id: string): any {
  // Busca por localName (o tag pode ter prefixo: xades:SignedProperties)
  const els = doc.getElementsByTagNameNS('*', tag);
  for (let i = 0; i < els.length; i++) {
    if (attrId(els[i]) === id) return els[i];
  }
  return null;
}

export function descendentesPorLocalName(no: any, nome: string): any[] {
  const out: any[] = [];
  const visitar = (n: any) => {
    if (!n?.childNodes) return;
    for (let i = 0; i < n.childNodes.length; i++) {
      const c = n.childNodes[i];
      if (c.localName === nome) out.push(c);
      visitar(c);
    }
  };
  visitar(no);
  return out;
}

/** DN em formato .NET (ordem do certificado, "TYPE=valor" vírgula-sep). */
function dnDotNet(atributos: any[]): string {
  return atributos.map((a) => `${a.shortName ?? a.name ?? a.type}=${a.value}`).join(',');
}

function serialDecimal(hex: string): string {
  return BigInt('0x' + hex).toString();
}

function qualifyingProperties(
  certDer: Buffer,
  issuerSerial: { issuerName: string; serialNumber: string },
  signatureId: string,
  agora: Date,
  politica: PoliticaXades | null | undefined
): string {
  const certDigest = b64(createHash('sha256').update(certDer).digest());
  const spId = `${signatureId}-signed-properties`;
  const signingTime = agora.toISOString().slice(0, 19) + 'Z';
  const policyXml = politica
    ? (
        '<xades:SignaturePolicyIdentifier>' +
        '<xades:SignaturePolicyId>' +
        '<xades:SigPolicyId>' +
        `<xades:Identifier Qualifier="OIDAsURN">${escapeXml(politica.identificador)}</xades:Identifier>` +
        '</xades:SigPolicyId>' +
        '<xades:SigPolicyHash>' +
        `<DigestMethod Algorithm="${ALGO_SHA256}" xmlns="${NS_DS}"></DigestMethod>` +
        `<DigestValue xmlns="${NS_DS}">${escapeXml(politica.digestBase64)}</DigestValue>` +
        '</xades:SigPolicyHash>' +
        (politica.spuri
          ? '<xades:SigPolicyQualifiers>' +
            '<xades:SigPolicyQualifier>' +
            `<xades:SPURI>${escapeXml(politica.spuri)}</xades:SPURI>` +
            '</xades:SigPolicyQualifier>' +
            '</xades:SigPolicyQualifiers>'
          : '') +
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
    `<DigestMethod Algorithm="${ALGO_SHA256}" xmlns="${NS_DS}"></DigestMethod>` +
    `<DigestValue xmlns="${NS_DS}">${certDigest}</DigestValue>` +
    '</xades:CertDigest>' +
    '<xades:IssuerSerial>' +
    `<X509IssuerName xmlns="${NS_DS}">${escapeXml(issuerSerial.issuerName)}</X509IssuerName>` +
    `<X509SerialNumber xmlns="${NS_DS}">${escapeXml(issuerSerial.serialNumber)}</X509SerialNumber>` +
    '</xades:IssuerSerial>' +
    '</xades:Cert>' +
    '</xades:SigningCertificate>' +
    policyXml +
    '</xades:SignedSignatureProperties>' +
    '</xades:SignedProperties>' +
    '</xades:QualifyingProperties>'
  );
}

export async function assinarProximoEsqueleto(xml: string, opts: OpcoesAssinaturaXades): Promise<string> {
  const forge = require('node-forge');
  const alvo = trechosAssinatura(xml).find((t) => t.esqueleto);
  if (!alvo) throw new Error('Artefato sem posição de assinatura pendente (esqueleto ausente)');

  const docSkeleton = parseDoc(xml);
  const noSkeleton = acharNoSkeleton(docSkeleton);
  const ancestral = noSkeleton?.parentNode ?? null;
  const refId = ancestral?.nodeType === 1 ? attrId(ancestral) : null;

  const certForge = forge.pki.certificateFromPem(opts.certPem);
  const certDer = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(certForge)).getBytes(), 'binary');
  const subjectName = dnDotNet((certForge.subject as any).attributes);
  const issuerName = dnDotNet((certForge.issuer as any).attributes);
  const serial = serialDecimal(certForge.serialNumber);
  const certB64 = opts.certPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');

  const signatureId = opts.signatureId ?? 'xmldsig-' + randomBytes(16).toString('hex');
  const agora = new Date();
  const spId = `${signatureId}-signed-properties`;
  const politicaFinal: PoliticaXades | null =
    opts.politica === null ? null : (opts.politica ?? POLITICA_ASSINATURA);
  const qp = qualifyingProperties(certDer, { issuerName, serialNumber: serial }, signatureId, agora, politicaFinal);

  // ---- digest #1: elemento alvo SEM assinaturas (computado no DOM do
  // documento COMPLETO para preservar o namespace herdado da raiz)
  const docBase = parseDoc(xml);
  let nodeAlvo: any;
  if (refId) {
    // acha o ancestral com @id no DOM completo
    const ancestralDom = acharElementoPorId(docBase, ancestral.tagName, refId);
    if (!ancestralDom) throw new Error(`Elemento com id="${refId}" não encontrado`);
    // CLONA e remove TODAS as Signature do clone (semântica do XPath)
    const clone = ancestralDom.cloneNode(true);
    const removerSigs = (el: any) => {
      for (let i = 0; i < el.childNodes?.length; i++) {
        const c = el.childNodes[i];
        if (c.localName === 'Signature' && (c.namespaceURI === NS_DS || c.namespaceURI === 'https://www.w3.org/2000/09/xmldsig#')) {
          el.removeChild(c); i--;
        } else if (c.nodeType === 1) {
          removerSigs(c);
        }
      }
    };
    removerSigs(clone);
    nodeAlvo = clone;
  } else {
    // sem @id: documento inteiro sem assinaturas
    const clone = docBase.documentElement.cloneNode(true);
    const removerSigs = (el: any) => {
      for (let i = 0; i < el.childNodes?.length; i++) {
        const c = el.childNodes[i];
        if (c.localName === 'Signature' && (c.namespaceURI === NS_DS || c.namespaceURI === 'https://www.w3.org/2000/09/xmldsig#')) {
          el.removeChild(c); i--;
        } else if (c.nodeType === 1) {
          removerSigs(c);
        }
      }
    };
    removerSigs(clone);
    nodeAlvo = clone;
  }
  const c14nAlvo = new C14nCanonicalization().process(nodeAlvo, {} as any);
  const digestDoc = b64(createHash('sha256').update(Buffer.from(c14nAlvo, 'utf8')).digest());

  const signedInfo =
    `<ds:SignedInfo xmlns:ds="${NS_DS}">` +
    `<ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></ds:CanonicalizationMethod>` +
    `<ds:SignatureMethod Algorithm="${ALGO_RSA}"></ds:SignatureMethod>` +
    `<ds:Reference URI="${refId ? '#' + refId : ''}">` +
    `<ds:Transforms>` +
    `<ds:Transform Algorithm="${ALGO_ENV}"></ds:Transform>` +
    `<ds:Transform Algorithm="${ALGO_XPATH}"><ds:XPath>${XPATH_SEM_ASSINATURAS}</ds:XPath></ds:Transform>` +
    `<ds:Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></ds:Transform>` +
    `</ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${ALGO_SHA256}"></ds:DigestMethod>` +
    `<ds:DigestValue>${digestDoc}</ds:DigestValue>` +
    `</ds:Reference>` +
    `<ds:Reference URI="#${spId}" Type="${TYPE_SIGNED_PROPERTIES}">` +
    `<ds:Transforms><ds:Transform Algorithm="${ALGO_C14N_EXC}"></ds:Transform></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${ALGO_SHA256}"></ds:DigestMethod>` +
    `<ds:DigestValue></ds:DigestValue>` +
    `</ds:Reference>` +
    `</ds:SignedInfo>`;

  const placeholder =
    `<ds:Signature xmlns:ds="${NS_DS}" Id="${signatureId}">` +
    signedInfo +
    '<ds:SignatureValue></ds:SignatureValue>' +
    '<ds:KeyInfo><ds:X509Data>' +
    `<ds:X509SubjectName>${escapeXml(subjectName)}</ds:X509SubjectName>` +
    `<ds:X509Certificate>${certB64}</ds:X509Certificate>` +
    '</ds:X509Data></ds:KeyInfo>' +
    `<ds:Object>${qp}</ds:Object>` +
    '</ds:Signature>';

  const inserirPh = (assinaturaXml: string): string =>
    xml.slice(0, alvo.inicio) + assinaturaXml + xml.slice(alvo.inicio + alvo.texto.length);

  // ---- digest #2: SignedProperties no contexto
  const docPh = parseDoc(inserirPh(placeholder));
  const spNode = acharElementoPorId(docPh, 'SignedProperties', spId);
  if (!spNode) throw new Error('SignedProperties não montado');
  const c14nSp = new C14nCanonicalization().process(spNode as any, {} as any);
  const digestSp = b64(createHash('sha256').update(Buffer.from(c14nSp, 'utf8')).digest());

  const signedInfoFinal = signedInfo.replace('<ds:DigestValue></ds:DigestValue>', `<ds:DigestValue>${digestSp}</ds:DigestValue>`);
  const placeholderFinal = placeholder.replace(signedInfo, signedInfoFinal);

  // ---- assina o C14N do SignedInfo no CONTEXTO
  const docPh2 = parseDoc(inserirPh(placeholderFinal));
  const sigPh = descendentesPorLocalName(docPh2.documentElement, 'Signature')
    .find((n: any) => attrId(n) === signatureId);
  let siNode: any = null;
  for (let i = 0; i < (sigPh?.childNodes?.length ?? 0); i++) {
    if (sigPh.childNodes[i].localName === 'SignedInfo') siNode = sigPh.childNodes[i];
  }
  if (!siNode) throw new Error('SignedInfo não montado');
  // exc-c14n: apenas namespaces VISIVELMENTE utilizados pelo próprio nó
  // (o ds: do SignedInfo é herdado mas utilizável → incluído; MEC não é
  // utilizável → excluído). SEM ancestorNamespaces (essência do exclusive).
  // C14n do SignedInfo com os MESMOS ancestorNamespaces que o verificador
  // computará via findAncestorNs no documento final — sem isso o SignedInfo
  // canônico diverge (faltaria xmlns herdado) e o RSA não verifica
  const { findAncestorNs } = await import('xml-crypto');
  const ancestorSi = findAncestorNs(docPh2 as any, "//*[local-name()='SignedInfo']");
  const c14nSi = new C14nCanonicalization().process(siNode as any, { ancestorNamespaces: ancestorSi });

  let signatureValue: string;
  if (opts.thumbprintA3) {
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
    `<ds:Signature xmlns:ds="${NS_DS}" Id="${signatureId}">` +
    signedInfoFinal +
    `<ds:SignatureValue>${signatureValue}</ds:SignatureValue>` +
    '<ds:KeyInfo><ds:X509Data>' +
    `<ds:X509SubjectName>${escapeXml(subjectName)}</ds:X509SubjectName>` +
    `<ds:X509Certificate>${certB64}</ds:X509Certificate>` +
    '</ds:X509Data></ds:KeyInfo>' +
    `<ds:Object>${qp}</ds:Object>` +
    '</ds:Signature>';

  return inserirPh(assinatura);
}

export async function assinarTodosEsqueletos(xml: string, opts: OpcoesAssinarTodos): Promise<string> {
  let out = xml;
  while (contarEsqueletos(out) > 0) {
    out = await assinarProximoEsqueleto(out, {
      chavePem: opts.chavePem,
      certPem: opts.certPem,
      thumbprintA3: opts.thumbprintA3,
      politica: opts.politica,
    });
    if (opts.carimbador) {
      out = (await carimbarAssinaturas(out, opts.carimbador)).xml;
    }
  }
  return out;
}

export function contarEsqueletos(xml: string): number {
  return trechosAssinatura(xml).filter((t) => t.esqueleto).length;
}

export async function carimbarAssinaturas(
  xml: string,
  obterCarimbo: (digest: Buffer) => Promise<{ token: Buffer; genTime?: string }>
): Promise<{ xml: string; carimbos: string[] }> {
  const { createHash: ch } = await import('node:crypto');
  let out = xml;
  const carimbos: string[] = [];
  for (const trecho of [...trechosAssinatura(xml)].reverse()) {
    if (trecho.esqueleto) continue;
    if (trecho.texto.includes('<xades:SignatureTimeStamp')) continue;
    const mValor = /<(?:ds:)?SignatureValue(?:\s[^>]*)?>([^<]+)<\/(?:ds:)?SignatureValue>/.exec(trecho.texto);
    const mId = /<(?:ds:)?Signature(?:\s[^>]*)?\sId="([^"]+)"/.exec(trecho.texto);
    const mFimQp = trecho.texto.lastIndexOf('</xades:QualifyingProperties>');
    if (!mValor || !mId || mFimQp < 0) continue;
    const digest = ch('sha256').update(Buffer.from(mValor[1], 'base64')).digest();
    const carimbo = await obterCarimbo(digest);
    const bloco =
      '<xades:UnsignedProperties>' +
      '<xades:UnsignedSignatureProperties>' +
      '<xades:SignatureTimeStamp>' +
      `<CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#" xmlns="${NS_DS}" />` +
      `<xades:EncapsulatedTimeStamp>${carimbo.token.toString('base64')}</xades:EncapsulatedTimeStamp>` +
      '</xades:SignatureTimeStamp>' +
      '</xades:UnsignedSignatureProperties>' +
      '</xades:UnsignedProperties>';
    const novoTrecho = trecho.texto.slice(0, mFimQp) + bloco + trecho.texto.slice(mFimQp);
    out = out.slice(0, trecho.inicio) + novoTrecho + out.slice(trecho.inicio + trecho.texto.length);
    carimbos.unshift(carimbo.genTime ?? '');
  }
  return { xml: out, carimbos };
}
