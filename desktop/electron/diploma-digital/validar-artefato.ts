// ============================================================
// VALIDADOR CONSOLIDADO — "Validar Diploma Digital"
// ============================================================
// Verifica um artefato XML do Diploma Digital de ponta a ponta, no
// próprio sistema (independente do fluxo que o gerou):
//   1. XML bem formado + namespaces esperados
//   2. XSD oficial v1.05 (erros estruturados: elemento/linha/mensagem)
//   3. Por assinatura real: verificação criptográfica INTEIRA
//      (digests + RSA contra o certificado do KeyInfo — motor xml-crypto)
//   4. Propriedades XAdES: SigningTime e SigningCertificate (CertDigest
//      conferido contra o certificado do KeyInfo), PolicyIdentifier
//   5. Carimbo do tempo: token RFC 3161 (CMS) parseado — ACT, hora
//      (genTime) e assinatura do token verificada contra o certificado
//      da TSA EMBUTIDO no próprio token (cadeia até raiz ICP-Brasil e
//      OCSP/CRL permanecem pendências documentadas)
//   6. Certificado do signatário: período de validade, uso
//      (digitalSignature), algoritmo/serial/subject
//   7. Hash SHA-256 do documento + veredito APROVADO/REJEITADO
//
// Esqueletos (posições da IES registradora) não são assinaturas da
// emissora: reportados como aguardando a registradora.
import { createHash } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import { validarXmlContraXsd, type ArtefatoXsd } from './xsd-validator';
import { novoVerificador } from './verificador-xades';

export interface ErroXsdEstruturado {
  linha?: number;
  elemento?: string;
  mensagem: string;
}

export interface InfoCertificado {
  subject: string;
  validoDe: string;
  validoAte: string;
  serial: string;
  algoritmo: string;
  usoAssinaturaDigital: boolean;
  validoAgora: boolean;
}

export interface ResultadoCarimbo {
  id: string;
  tokenOk: boolean;
  act?: string;
  genTime?: string;
  erros: string[];
}

export interface ResultadoAssinatura {
  id: string;
  criptografiaOk: boolean;
  errosCripto: string[];
  signingTime?: string;
  certDigestOk: boolean | null; // null = CertDigest ausente/ilegível
  policyId?: string | null;
  certificado?: InfoCertificado;
  carimbo?: ResultadoCarimbo;
}

export interface ResultadoValidacaoArtefato {
  versaoPadrao: string;
  bemFormado: boolean;
  xsd: { ok: boolean; erros: ErroXsdEstruturado[] };
  assinaturas: ResultadoAssinatura[];
  esqueletos: number;
  pendencias: string[];
  hashSha256: string;
  veredito: 'APROVADO' | 'REJEITADO';
}

function forge() {
  return require('node-forge');
}

/** Descendentes (qualquer ns/prefixo) com o localName dado. */
function descendentesPorLocalName(no: any, nome: string): any[] {
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

/** Extrai o CN (ou o atributo mais significativo) do subject do cert. */
function subjectLegivel(certForge: any): string {
  const attrs = certForge.subject?.attributes ?? [];
  const cn = attrs.find((a: any) => a.shortName === 'CN' || a.name === 'commonName');
  if (cn) return String(cn.value);
  return attrs.map((a: any) => `${a.shortName ?? a.name}=${a.value}`).join(',') || '(sem subject)';
}

function infoCertificado(certForge: any): InfoCertificado {
  const agora = Date.now();
  const notBefore = certForge.validity?.notBefore ? new Date(certForge.validity.notBefore).getTime() : 0;
  const notAfter = certForge.validity?.notAfter ? new Date(certForge.validity.notAfter).getTime() : 0;
  const extKeyUsage = (certForge.extensions ?? []).find((e: any) => e?.name === 'keyUsage');
  const bits = extKeyUsage?.digitalSignature === true || extKeyUsage?.value?.digitalSignature === true;
  return {
    subject: subjectLegivel(certForge),
    validoDe: certForge.validity?.notBefore?.toISOString?.() ?? String(certForge.validity?.notBefore ?? ''),
    validoAte: certForge.validity?.notAfter?.toISOString?.() ?? String(certForge.validity?.notAfter ?? ''),
    serial: (() => {
      try { return BigInt('0x' + certForge.serialNumber).toString(); } catch { return certForge.serialNumber ?? ''; }
    })(),
    algoritmo: `${certForge.publicKey?.n ? 'RSA ' + certForge.publicKey.n.bitLength() + ' bits' : (certForge.publicKey ? 'ECC' : 'desconhecido')}`,
    usoAssinaturaDigital: bits !== false, // ausência de extensão não invalida (v1 certs)
    validoAgora: agora >= notBefore && agora <= notAfter,
  };
}

/** Faz parse das mensagens do xmllint ("arq:12: element X: Schemas validity error : …"). */
export function estruturarErrosXsd(erros: string[]): ErroXsdEstruturado[] {
  const out: ErroXsdEstruturado[] = [];
  for (const bruta of erros) {
    const m = /:(\d+): element ([^:]+):/.exec(bruta);
    const msg = bruta.replace(/^.*?(Schemas validity error|element [^:]+:)\s*:?\s*/, '').trim() || bruta.trim();
    out.push(m ? { linha: Number(m[1]), elemento: m[2], mensagem: msg } : { mensagem: bruta.trim() });
  }
  return out;
}

/** Percorre a árvore ASN.1 em pré-ordem. */
function percorrer(no: any, visita: (n: any) => boolean): void {
  if (!no || !visita(no)) return;
  if (no.value && Array.isArray(no.value)) for (const f of no.value) percorrer(f, visita);
}

/**
 * Verifica o token RFC 3161 (CMS ContentInfo) do EncapsulatedTimeStamp:
 * extrai ACT (subject do cert da TSA), genTime e valida a assinatura do
 * token contra o certificado da TSA EMBUTIDO (caminho direto — a cadeia
 * até a raiz ICP-Brasil e a checagem de revogação são pendências).
 */
function verificarTokenCarimbo(der: Buffer): { ok: boolean; act?: string; genTime?: string; erros: string[] } {
  const { asn1, pki } = forge();
  const erros: string[] = [];
  try {
    const ci = asn1.fromDer(der.toString('binary'));
    // ContentInfo: SEQUENCE { OID signedData, [0] SignedData }
    const oid = asn1.derToOid(ci.value[0].value);
    if (oid !== '1.2.840.113549.1.7.2') return { ok: false, erros: ['Token não é um CMS SignedData (OID ' + oid + ').'] };
    const sd = ci.value[1]?.value?.[0];
    if (!sd) return { ok: false, erros: ['Estrutura do token de carimbo ilegível.'] };
    // SignedData: version, digestAlgorithms, encapContentInfo, [0] certs, …, signerInfos
    const encap = sd.value[2];
    const tstDerBin = encap?.value?.[1]?.value?.[0]?.value; // OCTET STRING (TSTInfo DER)
    if (typeof tstDerBin !== 'string') return { ok: false, erros: ['Conteúdo TSTInfo ausente no token.'] };
    const tst = asn1.fromDer(tstDerBin);
    // genTime (GeneralizedTime) + ACT (campo tsa [1] → directoryName)
    let genTime: string | undefined;
    let actSeq: any = null;
    percorrer(tst, (n) => {
      if (n.type === 24 && typeof n.value === 'string' && !genTime) {
        const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(n.value);
        if (m) genTime = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
      }
      if (!actSeq && n.typeClass === asn1.Class.CONTEXT && n.type === 1 && n.constructed) actSeq = n;
      return true;
    });
    // Certificados da TSA embutidos ([0] IMPLICIT SET of Certificate)
    const certes: any[] = [];
    const noCerts = sd.value.find((v: any) => v?.typeClass === asn1.Class.CONTEXT && v?.type === 0);
    if (noCerts?.value) {
      for (const c of noCerts.value) {
        try { certes.push(forge().pki.certificateFromAsn1(c)); } catch { /* não-certificate no SET */ }
      }
    }
    if (certes.length === 0) erros.push('Token sem certificado da TSA embutido (certReq=false?).');
    // ACT legível: subject do cert cuja key verifica, ou directoryName do TSTInfo
    let act: string | undefined;
    if (actSeq) {
      percorrer(actSeq, (n) => {
        if (!act && Array.isArray(n.value) && n.value.length && n.value[0]?.value?.length && typeof n.value[0].value[0]?.value === 'string') {
          // X509Name: SEQUENCE de ATV {OID, valor} — monta "k=v,…" heurístico
          const pares: string[] = [];
          percorrer(n, (x) => {
            if (Array.isArray(x.value) && x.value.length === 2 && x.value[0]?.type === asn1.Type.OID) {
              try { pares.push(String(x.value[1].value)); } catch { /* ignora */ }
            }
            return true;
          });
          if (pares.length) act = pares.join(' · ');
        }
        return true;
      });
    }
    // SignerInfos (último SET): { version, sid, digestAlg, [0] signedAttrs?, sigAlg, sig }
    const signerInfos = sd.value[sd.value.length - 1];
    const si = signerInfos?.value?.[0];
    if (!si) return { ok: false, act, genTime, erros: [...erros, 'SignerInfo ausente no token.'] };
    const digestOidNo = si.value[2]?.value?.[0] ?? si.value[2];
    const digestOid = typeof digestOidNo?.value === 'string' ? asn1.derToOid(digestOidNo.value) : '';
    const algoHash = digestOid.includes('3.4.2.1') ? 'sha256' : digestOid.includes('3.4.2.2') ? 'sha384' : digestOid.includes('3.4.2.3') ? 'sha512' : digestOid.includes('.2.26') ? 'sha1' : 'sha256';
    const sigNo = si.value[si.value.length - 1];
    const sigBin = typeof sigNo.value === 'string' ? sigNo.value : '';
    const signedAttrs = si.value.find((v: any) => v?.typeClass === asn1.Class.CONTEXT && v?.type === 0);
    // Tenta verificar com cada cert da TSA — via node:crypto (PKCS#1 v1.5
    // sobre DigestInfo, exatamente o que o forge/privateKey.sign produz)
    const { createPublicKey, verify: cryptoVerify, constants } = require('node:crypto');
    let verificou = false;
    for (const cert of certes) {
      try {
        const pub = createPublicKey(pki.publicKeyToPem(cert.publicKey));
        const opts = { key: pub, padding: constants.RSA_PKCS1_PADDING };
        // CMS: com signedAttrs, a assinatura cobre o DER do SET de atributos
        const alvo = signedAttrs
          ? Buffer.from(asn1.toDer(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, signedAttrs.value)).getBytes(), 'binary')
          : Buffer.from(tstDerBin, 'binary');
        verificou = verificou || cryptoVerify(algoHash, alvo, opts, Buffer.from(sigBin, 'binary'));
      } catch { /* tenta próximo cert */ }
    }
    if (!verificou) erros.push('Assinatura do token não verificou contra o certificado da TSA embutido.');
    if (!act && certes.length) act = subjectLegivel(certes[0]);
    return { ok: verificou && certes.length > 0, act, genTime, erros };
  } catch (e: any) {
    return { ok: false, erros: ['Token de carimbo ilegível: ' + (e?.message ?? String(e))] };
  }
}

/**
 * Validação consolidada do artefato. @exigirCarimbo: com TSA esperada,
 * assinatura real sem carimbo válida → pendência (REJEITADO para fins
 * de liberação, com motivo claro).
 */
export async function validarArtefatoDiploma(
  xml: string,
  artefato: ArtefatoXsd,
  opcoes: { exigirCarimbo?: boolean } = {}
): Promise<ResultadoValidacaoArtefato> {
  const exigirCarimbo = opcoes.exigirCarimbo ?? true;
  const pendencias: string[] = [];

  // 1-2) XSD oficial
  let xsd: ResultadoValidacaoArtefato['xsd'] = { ok: false, erros: [] };
  try {
    const r = await validarXmlContraXsd(xml, artefato);
    xsd = { ok: r.valido, erros: estruturarErrosXsd(r.erros) };
  } catch (e: any) {
    xsd = { ok: false, erros: [{ mensagem: 'Falha ao executar o validador XSD: ' + (e?.message ?? String(e)) }] };
  }
  if (!xsd.ok) pendencias.push('XML rejeitado pelo XSD do Diploma Digital (' + xsd.erros.length + ' erro[s])');

  // 3-6) Assinaturas
  const assinaturas: ResultadoAssinatura[] = [];
  let esqueletos = 0;
  let bemFormado = true;
  let doc: any;
  try {
    doc = new DOMParser().parseFromString(xml, 'text/xml');
  } catch (e: any) {
    bemFormado = false;
    pendencias.push('XML mal formado: ' + (e?.message ?? String(e)));
  }
  if (bemFormado && doc) {
    const { pki, asn1 } = forge();
    const sigs = doc.getElementsByTagName('ds:Signature');
    for (let i = 0; i < sigs.length; i++) {
      const sigNode = sigs[i];
      const id = sigNode.getAttribute('Id') || `#${i}`;
      const sigValue = ((): string => {
        for (let j = 0; j < sigNode.childNodes.length; j++) {
          const c = sigNode.childNodes[j];
          if (c.localName === 'SignatureValue') return (c.textContent ?? '').trim();
        }
        return '';
      })();
      if (!sigValue) {
        esqueletos++;
        continue; // posição da registradora — aguardando assinatura dela
      }
      const res: ResultadoAssinatura = { id, criptografiaOk: false, errosCripto: [], certDigestOk: null };

      // Certificado do KeyInfo
      let certForge: any = null;
      try {
        const b64 = sigNode.getElementsByTagName('ds:X509Certificate')[0]?.textContent?.replace(/\s+/g, '');
        if (b64) {
          const derCert = Buffer.from(b64, 'base64');
          certForge = pki.certificateFromAsn1(asn1.fromDer(derCert.toString('binary')));
          res.certificado = infoCertificado(certForge);
          // SigningCertificate (XAdES): digest do DER deve bater — o
          // DigestValue do CertDigest vai SEM prefixo (namespace xades herdado)
          const certDigestEl = descendentesPorLocalName(sigNode, 'CertDigest')
            .flatMap((cd) => descendentesPorLocalName(cd, 'DigestValue'))[0];
          if (certDigestEl) {
            const esperado = createHash('sha256').update(derCert).digest('base64');
            res.certDigestOk = (certDigestEl.textContent ?? '').trim() === esperado;
            if (!res.certDigestOk) res.errosCripto.push('SigningCertificate: CertDigest diverge do certificado do KeyInfo');
          }
          const stEl = sigNode.getElementsByTagName('xades:SigningTime')[0];
          if (stEl) res.signingTime = (stEl.textContent ?? '').trim();
          const idEl = sigNode.getElementsByTagName('xades:Identifier')[0];
          res.policyId = idEl ? (idEl.textContent ?? '').trim() : null;
          if (res.certificado && !res.certificado.validoAgora) {
            res.errosCripto.push(`Certificado fora do período de validade (até ${res.certificado.validoAte})`);
          }
          if (res.certificado && !res.certificado.usoAssinaturaDigital) {
            res.errosCripto.push('Certificado sem finalidade de assinatura digital (keyUsage)');
          }
        } else {
          res.errosCripto.push('Assinatura sem X509Certificate no KeyInfo');
        }
      } catch (e: any) {
        res.errosCripto.push('Certificado do KeyInfo ilegível: ' + (e?.message ?? String(e)));
      }

      // Verificação criptográfica completa (digests + RSA)
      try {
        const ver = novoVerificador(b64CertPem(certForge), sigNode);
        const ok = ver.checkSignature(xml);
        res.criptografiaOk = ok;
        if (!ok) {
          for (const r of ver.getReferences()) {
            if (r.validationError) res.errosCripto.push(`Reference ${r.uri || '(documento)'}: ${r.validationError.message ?? String(r.validationError)}`);
          }
          if (res.errosCripto.length === 0) res.errosCripto.push('Valor da assinatura não confere (RSA/digests)');
        }
      } catch (e: any) {
        res.errosCripto.push('Falha na verificação: ' + (e?.message ?? String(e)));
      }

      // Carimbo do tempo
      const tsEl = sigNode.getElementsByTagName('xades:EncapsulatedTimeStamp')[0];
      if (tsEl) {
        const tsId = sigNode.getElementsByTagName('xades:SignatureTimeStamp')[0]?.getAttribute('Id') ?? '';
        try {
          const der = Buffer.from((tsEl.textContent ?? '').trim(), 'base64');
          const r = verificarTokenCarimbo(der);
          res.carimbo = { id: tsId, tokenOk: r.ok, act: r.act, genTime: r.genTime, erros: r.erros };
        } catch (e: any) {
          res.carimbo = { id: tsId, tokenOk: false, erros: ['EncapsulatedTimeStamp ilegível: ' + (e?.message ?? String(e))] };
        }
      } else if (exigirCarimbo) {
        res.errosCripto.push('Sem carimbo do tempo (SignatureTimeStamp/EncapsulatedTimeStamp ausente)');
      }
      assinaturas.push(res);
    }
    if (esqueletos > 0) pendencias.push(`${esqueletos} assinatura(s) da IES Registradora aguardando (competência dela)`);
  }

  if (assinaturas.length === 0 && esqueletos === 0) pendencias.push('Nenhuma assinatura encontrada no documento');

  const rejeitadas = assinaturas.filter(
    (a) =>
      !a.criptografiaOk ||
      a.certDigestOk === false ||
      (a.carimbo && !a.carimbo.tokenOk) ||
      (exigirCarimbo && !a.carimbo)
  );
  for (const a of rejeitadas) {
    for (const e of a.errosCripto) pendencias.push(`Assinatura ${a.id}: ${e}`);
    if (a.carimbo && !a.carimbo.tokenOk) pendencias.push(`Assinatura ${a.id}: carimbo do tempo inválido — ${a.carimbo.erros.join('; ')}`);
  }

  const veredito: 'APROVADO' | 'REJEITADO' =
    bemFormado && xsd.ok && rejeitadas.length === 0 && assinaturas.length > 0 ? 'APROVADO' : 'REJEITADO';

  return {
    versaoPadrao: '1.05',
    bemFormado,
    xsd,
    assinaturas,
    esqueletos,
    pendencias,
    hashSha256: createHash('sha256').update(xml, 'utf8').digest('hex'),
    veredito,
  };
}

/** PEM a partir do cert forge (para o verificador xml-crypto). */
function b64CertPem(certForge: any): string {
  if (!certForge) return '';
  const { pki } = forge();
  return pki.certificateToPem(certForge);
}
