// ============================================================
// CRL (Certificate Revocation List, RFC 5280) — parse e verificação
// ============================================================
// Parse do CertificateList em ASN.1 (node-forge) SEM simulação:
//   CertificateList ::= SEQUENCE { tbsCertList, signatureAlgorithm,
//                                  signatureValue }
//   TBSCertList     ::= SEQUENCE { version?, signature, issuer,
//                                  thisUpdate, nextUpdate?,
//                                  revokedCertificates?, crlExtensions? }
//
// - Assinatura da CRL verificada com node:crypto contra a chave pública
//   do certificado EMISSOR (vínculo criptográfico — não comparação de DN).
// - Revogação por número de SÉRIE (decimal, como o X509SerialNumber).
// - crlNumber (ext 2.5.29.20) extraído quando presente p/ o
//   CRLIdentifier do XAdES (Number é OPCIONAL no schema 1.3.2).
import { createPublicKey, verify as cryptoVerify, constants } from 'node:crypto';

export interface CrlInfo {
  issuerDn: string;
  thisUpdate: string; // ISO
  nextUpdate?: string; // ISO
  /** Seriais revogados em DECIMAL (strings — podem exceder Number). */
  revogados: string[];
  crlNumber?: string; // decimal
  algoritmoAssinatura: string;
  /** DER original do tbsCertList (re-codificado) p/ verificação. */
  tbsDer: Buffer;
  assinatura: Buffer;
  hashAlgoritmo: string | null;
}

function forge() {
  return require('node-forge');
}

/** Converte UTCTime (YYMMDDHHMMSSZ) ou GeneralizedTime p/ ISO. */
function tempoParaIso(v: string): string | null {
  let m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z?$/.exec(v);
  if (m) {
    const ano = Number(m[1]) >= 50 ? 1900 + Number(m[1]) : 2000 + Number(m[1]);
    return `${ano}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  }
  m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  return null;
}

const HASH_POR_OID: Record<string, string> = {
  '1.2.840.113549.1.1.5': 'sha1',
  '1.2.840.113549.1.1.11': 'sha256',
  '1.2.840.113549.1.1.12': 'sha384',
  '1.2.840.113549.1.1.13': 'sha512',
};

const NOMES_ATTR: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.5': 'serialNumber',
  '1.2.840.113549.1.9.1': 'E',
};

/** DN legível de um Name ASN.1 (SEQUENCE de RDN SETs). */
function dnLegivel(nameNode: any): string {
  const { asn1 } = forge();
  const rdns: string[] = [];
  for (const rdn of nameNode.value ?? []) {
    // RDN = SET de AttributeTypeAndValue
    const atvs = Array.isArray(rdn.value) ? rdn.value : [rdn];
    for (const atv of atvs) {
      if (!Array.isArray(atv.value) || atv.value.length < 2) continue;
      if (atv.value[0]?.type !== asn1.Type.OID) continue;
      try {
        const oid = asn1.derToOid(atv.value[0].value);
        rdns.push(`${NOMES_ATTR[oid] ?? oid}=${String(atv.value[1].value)}`);
      } catch { /* ignora */ }
    }
  }
  return rdns.join(',') || '(DN ilegível)';
}

/** Parse do CertificateList DER. Lança erro se estrutura ilegível. */
export function parsearCrl(der: Buffer): CrlInfo {
  const { asn1 } = forge();
  const topo = asn1.fromDer(der.toString('binary'));
  if (!Array.isArray(topo.value) || topo.value.length < 3) {
    throw new Error('CRL: estrutura CertificateList incompleta.');
  }
  const [tbs, sigAlg, sigVal] = topo.value;
  let i = 0;
  // version INTEGER opcional
  if (tbs.value[i]?.type === asn1.Type.INTEGER) i++;
  const algoritmoAssinatura = (() => {
    try {
      return asn1.derToOid(sigAlg.value?.[0]?.value ?? tbs.value[i + 1]?.value?.[0]?.value);
    } catch {
      return '';
    }
  })();
  i++; // signature AlgorithmIdentifier (ignorado — o do topo é o mesmo)
  const issuer = tbs.value[i++];
  const thisUpdateRaw = tbs.value[i++];
  let nextUpdate: string | undefined;
  if (tbs.value[i] && (tbs.value[i].type === 23 || tbs.value[i].type === 24) && typeof tbs.value[i].value === 'string') {
    nextUpdate = tempoParaIso(tbs.value[i++].value) ?? undefined;
  }
  const revogados: string[] = [];
  let crlNumber: string | undefined;
  const proximo = tbs.value[i];
  if (Array.isArray(proximo?.value)) {
    if (proximo.tagClass === asn1.Class.UNIVERSAL && proximo.type === asn1.Type.SEQUENCE) {
      // revokedCertificates
      for (const entrada of proximo.value) {
        const serial = entrada.value?.[0];
        if (serial?.type === asn1.Type.INTEGER && typeof serial.value === 'string') {
          try {
            const hex = Buffer.from(serial.value, 'binary').toString('hex').replace(/^0+(?=.)/, '');
            revogados.push(BigInt('0x' + (hex || '0')).toString());
          } catch { /* ignora */ }
        }
      }
      i++;
    } else if (proximo.tagClass === asn1.Class.CONTEXT_SPECIFIC && proximo.type === 0) {
      // crlExtensions direto (sem revokedCertificates)
    }
  }
  const exts = tbs.value[i];
  if (exts?.tagClass === asn1.Class.CONTEXT_SPECIFIC && exts.type === 0 && Array.isArray(exts.value)) {
    // [0] EXPLICIT Extensions → SEQUENCE de Extension { OID, ?, OCTET STRING }
    for (const ext of exts.value[0]?.value ?? []) {
      try {
        const oid = asn1.derToOid(ext.value?.[0]?.value);
        if (oid === '2.5.29.20') {
          // CRLNumber: Extension { OID, [critical], OCTET STRING } — o valor
          // do OCTET STRING contém um INTEGER DER
          const bruto = ext.value.slice(1).find((v: any) => v?.type === asn1.Type.OCTETSTRING);
          const inteiroBruto = bruto
            ? (typeof bruto.value === 'string'
                ? bruto.value
                : Array.isArray(bruto.value) && typeof bruto.value[0]?.value === 'string' ? bruto.value[0].value : null)
            : null;
          if (inteiroBruto != null) {
            // extnValue = DER do valor da extensão (aqui: INTEGER)
            const inteiro = asn1.fromDer(inteiroBruto);
            if (typeof inteiro.value === 'string') {
              const hex = Buffer.from(inteiro.value, 'binary').toString('hex').replace(/^0+(?=.)/, '');
              crlNumber = BigInt('0x' + (hex || '0')).toString();
            }
          }
        }
      } catch { /* ignora */ }
    }
  }
  const thisUpdate = tempoParaIso(thisUpdateRaw.value) ?? '';
  if (!thisUpdate) throw new Error('CRL: thisUpdate ausente/ilegível.');
  const assinatura = (() => {
    // BIT STRING: primeiro byte = unused bits (0), resto = assinatura
    const bin = typeof sigVal.value === 'string' ? sigVal.value : '';
    return Buffer.from(bin.length && bin.charCodeAt(0) === 0 ? bin.slice(1) : bin, 'binary');
  })();
  return {
    issuerDn: dnLegivel(issuer),
    thisUpdate,
    nextUpdate,
    revogados,
    crlNumber,
    algoritmoAssinatura,
    tbsDer: Buffer.from(asn1.toDer(tbs).getBytes(), 'binary'),
    assinatura,
    hashAlgoritmo: HASH_POR_OID[algoritmoAssinatura] ?? null,
  };
}

/** Verifica a ASSINATURA da CRL contra a chave pública do certificado emissor. */
export function verificarAssinaturaCrl(crl: CrlInfo, certEmissorPem: string): boolean {
  if (!crl.hashAlgoritmo || crl.assinatura.length === 0) return false;
  try {
    const cert = forge().pki.certificateFromPem(certEmissorPem);
    const pub = createPublicKey(forge().pki.publicKeyToPem(cert.publicKey));
    return cryptoVerify(
      crl.hashAlgoritmo,
      crl.tbsDer,
      { key: pub, padding: constants.RSA_PKCS1_PADDING },
      crl.assinatura
    );
  } catch {
    return false;
  }
}

/** Encontra, entre os certificados, qual EMITE a CRL (verifica a assinatura). */
export function emissorDaCrl(crl: CrlInfo, certPems: string[]): string | null {
  for (const pem of certPems) {
    if (verificarAssinaturaCrl(crl, pem)) return pem;
  }
  return null;
}

export interface ResultadoRevogacao {
  status: 'revogado' | 'valido' | 'indeterminado';
  /** Preenchido quando revogado/erros. */
  detalhe: string;
  crlInfo?: CrlInfo;
}

/** Checa a revogação de um certificado contra UMA CRL (do seu emissor).
 *  Vigência temporal da CRL (nextUpdate) é reportada no detalhe —
 *  CRL vencida NÃO declara "valido" (indeterminado). */
export function verificarRevogacao(certPem: string, crlDer: Buffer, emissorPem: string): ResultadoRevogacao {
  try {
    const cert = forge().pki.certificateFromPem(certPem);
    const serial = BigInt('0x' + cert.serialNumber).toString();
    const crl = parsearCrl(crlDer);
    if (!verificarAssinaturaCrl(crl, emissorPem)) {
      return { status: 'indeterminado', detalhe: 'CRL não é emitida pelo certificado informado (assinatura não confere).', crlInfo: crl };
    }
    const agora = Date.now();
    const vencida = crl.nextUpdate && new Date(crl.nextUpdate).getTime() < agora;
    if (crl.revogados.includes(serial)) {
      return { status: 'revogado', detalhe: `Serial ${serial} consta na CRL de ${crl.issuerDn} (emitida ${crl.thisUpdate}).`, crlInfo: crl };
    }
    if (vencida) {
      return { status: 'indeterminado', detalhe: `CRL vencida (nextUpdate ${crl.nextUpdate}) — baixe uma CRL atual.`, crlInfo: crl };
    }
    return { status: 'valido', detalhe: `Serial ${serial} não consta na CRL de ${crl.issuerDn} (emitida ${crl.thisUpdate}${crl.nextUpdate ? `, válida até ${crl.nextUpdate}` : ''}).`, crlInfo: crl };
  } catch (e: any) {
    return { status: 'indeterminado', detalhe: 'CRL ilegível: ' + (e?.message ?? String(e)) };
  }
}
