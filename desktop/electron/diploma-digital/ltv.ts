// ============================================================
// LTV — XAdES-C/XL (validação de longo prazo)
// ============================================================
// Complementa a assinatura com as propriedades NÃO assinadas exigidas pela
// política PA-AD-RC v2.4 (perfil XL): CompleteCertificateRefs,
// CompleteRevocationRefs, CertificateValues, RevocationValues e
// SigAndRefsTimeStamp (2º carimbo sobre as referências) — todos com dados
// REAIS: cadeia de certificação resolvida pelo Windows (X509Chain com AIA)
// e CRLs baixadas das URLs CRLDistributionPoints de cada certificado.
// Nada é simulado: se a cadeia/CRL não estiver disponível (offline), o
// chamador segue SEM LTV com aviso explícito.
//
// Estrutura por assinatura (mesma ordem do documento de referência):
//   UnsignedSignatureProperties
//     ├── SignatureTimeStamp          (já aplicado pelo assinador)
//     ├── CompleteCertificateRefs     (CertRefs da cadeia SEM o signatário)
//     ├── CompleteRevocationRefs      (CRLRefs com digest de cada CRL)
//     ├── CertificateValues           (certificados da cadeia SEM o signatário)
//     ├── RevocationValues            (CRLs completas)
//     └── SigAndRefsTimeStamp         (2º carimbo ACT sobre as refs)
import { createHash } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import { ExclusiveCanonicalization } from 'xml-crypto';
import { NS_DS, escapeXml } from './xml-utils';
import { trechosAssinatura } from './xades-signer';
import { parsearCrl, verificarAssinaturaCrl, type CrlInfo } from './crl';

const ALGO_SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';

export interface DadosLtv {
  /** Cadeia PEMs: leaf primeiro → intermediárias → raiz. */
  cadeiaPems: string[];
  /** CRLs DER na ordem da cadeia (índice = certificado a que pertence). */
  crls: (Buffer | null)[];
}

/** Cadeia de certificação via Windows X509Chain (resolve intermediárias
 *  pela AIA automaticamente) — PowerShell, mesmo padrão dos scripts A3. */
export async function coletarCadeia(certPemLeaf: string): Promise<string[]> {
  const r = await verificarCadeiaComStatus(certPemLeaf);
  return r.cadeiaPems;
}

export interface StatusElementoCadeia {
  subject: string;
  status: string[];
}

export interface StatusCadeia {
  ok: boolean;
  /** Raiz da cadeia está no repositório de confiança do Windows? */
  confiaNaRaiz: boolean;
  elementos: StatusElementoCadeia[];
  erros: string[];
}

/** Cadeia + STATUS REAL por elemento (X509Chain.Status por elemento:
 *  NotTimeValid, UntrustedRoot, RevocationStatusUnknown, …) e confiança
 *  na raiz (segunda construção SEM AllowUnknownCertificateAuthority).
 *  Não lança — devolve erros (offline/AIA inacessível vira status). */
export async function verificarCadeiaComStatus(certPemLeaf: string): Promise<{ cadeiaPems: string[]; status: StatusCadeia }> {
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const { runPowerShellScriptAsync } = await import('../ipc/assinatura');
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const dir = path.join(os.tmpdir(), `nexa_chain_${id}`);
  fs.mkdirSync(dir, { recursive: true });
  const certFile = path.join(dir, 'leaf.pem');
  fs.writeFileSync(certFile, certPemLeaf, 'utf8');
  const script = `
param([string]$CertFile, [string]$OutDir)
$ErrorActionPreference = 'Stop'
$leaf = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($CertFile)
# 1) monta a cadeia (AIA), SEM revogação e permitindo raiz desconhecida —
#    apenas para OBTER os elementos e o status individual de cada um.
$chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
$chain.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
$chain.ChainPolicy.VerificationFlags = [System.Security.Cryptography.X509Certificates.X509VerificationFlags]::AllowUnknownCertificateAuthority
[void]$chain.Build($leaf)
$i = 0
foreach ($el in $chain.ChainElements) {
  $b64 = [Convert]::ToBase64String($el.Certificate.RawData, 'InsertLineBreaks')
  $pem = "-----BEGIN CERTIFICATE-----" + [char]10 + $b64 + [char]10 + "-----END CERTIFICATE-----" + [char]10
  [System.IO.File]::WriteAllText((Join-Path $OutDir ("c" + $i + ".pem")), $pem, (New-Object System.Text.UTF8Encoding($false)))
  $st = ($el.Status | ForEach-Object { $_.ToString() }) -join ';'
  Write-Output ("ELEM:" + $i + "|" + $st + "|" + $el.Certificate.Subject)
  $i++
}
# 2) raiz é CONFIADA? (sem AllowUnknown — a resposta real do Windows)
$chain2 = New-Object System.Security.Cryptography.X509Certificates.X509Chain
$chain2.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
$rootOk = $chain2.Build($leaf)
Write-Output ("TRUST:" + $rootOk)
Write-Output ("OK:" + $i)
`.trim();
  try {
    const saida = await runPowerShellScriptAsync(script, { CertFile: certFile, OutDir: dir }, 60000);
    const pems: string[] = [];
    let i = 0;
    while (fs.existsSync(path.join(dir, `c${i}.pem`))) {
      pems.push(fs.readFileSync(path.join(dir, `c${i}.pem`), 'utf8').replace(/\r\n/g, '\n'));
      i++;
    }
    if (pems.length === 0) throw new Error('Cadeia vazia retornada pelo Windows.');
    const elementos: StatusElementoCadeia[] = [];
    let confiaNaRaiz = false;
    for (const linha of String(saida ?? '').split(/\r?\n/)) {
      const m = /^ELEM:(\d+)\|([^|]*)\|(.*)$/.exec(linha.trim());
      if (m) elementos.push({ subject: m[3], status: m[2] ? m[2].split(';').filter(Boolean) : [] });
      const t = /^TRUST:(True|False)$/i.exec(linha.trim());
      if (t) confiaNaRaiz = t[1].toLowerCase() === 'true';
    }
    const erros: string[] = [];
    if (!confiaNaRaiz) erros.push('Raiz da cadeia NÃO está no repositório de confiança do Windows (instale a cadeia ICP-Brasil / verifique a AC).');
    for (const el of elementos) {
      for (const s of el.status) {
        if (s === 'UntrustedRoot' && !confiaNaRaiz) continue; // já reportado acima
        erros.push(`${el.subject}: ${s}`);
      }
    }
    return { cadeiaPems: pems, status: { ok: erros.length === 0, confiaNaRaiz, elementos, erros } };
  } finally {
    try { (await import('node:fs')).rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

/** URLs de CRL (CRLDistributionPoints, ext 2.5.29.31) do certificado. */
export function urlsCrlDoCert(certPem: string): string[] {
  const forge = require('node-forge');
  const { asn1 } = forge;
  try {
    const der = asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(certPem))).getBytes();
    const urls: string[] = [];
    // percorre o DER procurando o OID 2.5.29.31 e extrai URLs do valor
    const OID = asn1.oidToDer('2.5.29.31').getBytes();
    let idx = der.indexOf(OID);
    while (idx >= 0) {
      const janela = der.slice(idx, idx + 2000);
      for (const m of janela.matchAll(/https?:\/\/[!-~]+/g)) {
        if (!urls.includes(m[0])) urls.push(m[0]);
      }
      idx = der.indexOf(OID, idx + 1);
    }
    return urls.slice(0, 3);
  } catch {
    return [];
  }
}

/** Baixa a CRL (DER) com timeout; null se indisponível. */
export async function baixarCrl(url: string, timeoutMs = 20000): Promise<Buffer | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 100 ? buf : null;
  } catch {
    return null;
  }
}

/** Coleta a cadeia + CRLs de cada certificado (best-effort: CRL ausente
 *  fica null e o chamador decide como tratar — nunca simula). */
export async function coletarDadosLtv(certPemLeaf: string): Promise<DadosLtv> {
  const cadeiaPems = await coletarCadeia(certPemLeaf);
  const crls: (Buffer | null)[] = [];
  for (const pem of cadeiaPems) {
    const urls = urlsCrlDoCert(pem);
    let crl: Buffer | null = null;
    for (const u of urls) {
      crl = await baixarCrl(u);
      if (crl) break;
    }
    crls.push(crl);
  }
  return { cadeiaPems, crls };
}

function certDer(pem: string): Buffer {
  const forge = require('node-forge');
  return Buffer.from(
    forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(pem))).getBytes(),
    'binary'
  );
}

function infoCert(pem: string): { der: Buffer; b64: string; issuerName: string; serial: string } {
  const forge = require('node-forge');
  const c = forge.pki.certificateFromPem(pem);
  const dn = (attrs: any[]) => attrs.map((a) => `${a.shortName ?? a.name ?? a.type}=${a.value}`).join(',');
  return {
    der: certDer(pem),
    b64: pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''),
    issuerName: dn((c.issuer as any).attributes),
    serial: BigInt('0x' + c.serialNumber).toString(),
  };
}

/**
 * Aplica LTV (perfil XL da política) a TODAS as assinaturas reais do
 * artefato: refs + valores + SigAndRefsTimeStamp (2º carimbo via ACT).
 * @obterCarimbo recebe o digest e devolve o token RFC 3161.
 */
export async function aplicarLtv(
  xml: string,
  certPemLeaf: string,
  obterCarimbo: (digest: Buffer) => Promise<{ token: Buffer; genTime?: string }>
): Promise<{ xml: string; avisos: string[] }> {
  const { cadeiaPems, crls } = await coletarDadosLtv(certPemLeaf);
  const avisos: string[] = [];
  const cadeiaSemLeaf = cadeiaPems.slice(1); // leaf já está no KeyInfo
  const infos = cadeiaSemLeaf.map(infoCert);
  if (infos.length === 0) throw new Error('Cadeia de certificação indisponível (apenas o próprio certificado).');
  if (crls.every((c) => c == null)) throw new Error('Nenhuma CRL pôde ser baixada (offline?) — LTV indisponível.');
  const crlsOk = crls.filter((c): c is Buffer => c != null);

  // Blocos XL (idênticos para as assinaturas do MESMO signatário)
  // Todos no namespace xades (default herdado do QualifyingProperties).
  const refsCert =
    '<xades:CompleteCertificateRefs><xades:CertRefs>' +
    infos
      .map(
        (i) =>
          '<xades:Cert>' +
          '<xades:CertDigest>' +
          `<DigestMethod Algorithm="${ALGO_SHA256}" xmlns="${NS_DS}" />` +
          `<DigestValue xmlns="${NS_DS}">${createHash('sha256').update(i.der).digest('base64')}</DigestValue>` +
          '</xades:CertDigest>' +
          '<xades:IssuerSerial>' +
          `<X509IssuerName xmlns="${NS_DS}">${escapeXml(i.issuerName)}</X509IssuerName>` +
          `<X509SerialNumber xmlns="${NS_DS}">${i.serial}</X509SerialNumber>` +
          '</xades:IssuerSerial>' +
          '</xades:Cert>'
      )
      .join('') +
    '</xades:CertRefs></xades:CompleteCertificateRefs>';

  // Parse das CRLs + pareamento CRIPTOGRÁFICO: a CRL que cobre o cert X é
  // a assinada pelo EMISSOR de X — verifica-se a assinatura da CRL contra
  // a chave de cada cert da cadeia (vínculo real; heurística de índice
  // antiga removida). CRL ilegível é ignorada (nunca inventa valor).
  const crlsParseadas: { crl: Buffer; info: CrlInfo }[] = [];
  for (const crl of crlsOk) {
    try { crlsParseadas.push({ crl, info: parsearCrl(crl) }); } catch { /* ilegível */ }
  }
  const crlInfos: { crl: Buffer; info: CrlInfo }[] = [];
  for (const pem of cadeiaPems) {
    const achou = crlsParseadas.find((c) => verificarAssinaturaCrl(c.info, pem));
    if (achou && !crlInfos.includes(achou)) crlInfos.push(achou);
  }

  // CRLRef conforme XAdES 1.3.2: DigestAlgAndValue + CRLIdentifier —
  // IssueTime/Number extraídos da PRÓPRIA CRL (thisUpdate/crlNumber),
  // nunca fabricados.
  const refsCrl =
    '<xades:CompleteRevocationRefs><xades:CRLRefs>' +
    crlInfos
      .map(
        (x) =>
          '<xades:CRLRef>' +
          '<xades:DigestAlgAndValue>' +
          `<DigestMethod Algorithm="${ALGO_SHA256}" xmlns="${NS_DS}" />` +
          `<DigestValue xmlns="${NS_DS}">${createHash('sha256').update(x.crl).digest('base64')}</DigestValue>` +
          '</xades:DigestAlgAndValue>' +
          '<xades:CRLIdentifier>' +
          `<xades:Issuer>${escapeXml(x.info.issuerDn)}</xades:Issuer>` +
          `<xades:IssueTime>${x.info.thisUpdate}</xades:IssueTime>` +
          (x.info.crlNumber ? `<xades:Number>${x.info.crlNumber}</xades:Number>` : '') +
          '</xades:CRLIdentifier>' +
          '</xades:CRLRef>'
      )
      .join('') +
    '</xades:CRLRefs></xades:CompleteRevocationRefs>';

  const valoresCert =
    '<xades:CertificateValues>' +
    infos.map((i) => `<xades:EncapsulatedX509Certificate>${i.b64}</xades:EncapsulatedX509Certificate>`).join('') +
    '</xades:CertificateValues>';

  const valoresCrl =
    '<xades:RevocationValues><xades:CRLValues>' +
    crlInfos.map((x) => `<xades:EncapsulatedCRLValue>${x.crl.toString('base64')}</xades:EncapsulatedCRLValue>`).join('') +
    '</xades:CRLValues></xades:RevocationValues>';

  let out = xml;
  // ordem REVERSA (offsets)
  for (const trecho of [...trechosAssinatura(xml)].reverse()) {
    if (trecho.esqueleto) continue;
    if (trecho.texto.includes('<xades:SigAndRefsTimeStamp')) continue; // já aplicado
    const mFim = trecho.texto.indexOf('</SignatureTimeStamp>');
    if (mFim < 0) continue; // sem 1º carimbo — LTV exige carimbo antes
    const inserirApos = mFim + '</SignatureTimeStamp>'.length;
    const blocoXl =
      refsCert + refsCrl + valoresCert + valoresCrl;
    // 2º carimbo: digest sobre as UnsignedSignatureProperties (com o que
    // existe até então: SignatureTimeStamp + refs + valores), exc-c14n
    const doc = new DOMParser().parseFromString(out, 'text/xml');
    const usp = doc.getElementsByTagNameNS('*', 'UnsignedSignatureProperties');
    let uspNode: any = null;
    for (let i = 0; i < usp.length; i++) {
      const dono: any = usp[i].parentNode?.parentNode?.parentNode;
      if (dono && trecho.texto.includes(`Id="${dono.getAttribute?.('Id')}"`)) uspNode = usp[i];
    }
    let token: Buffer | null = null;
    if (uspNode) {
      // placeholder com os blocos XL antes do 2º carimbo p/ computar o digest
      const comXl =
        out.slice(0, trecho.inicio) +
        trecho.texto.slice(0, inserirApos) + blocoXl + trecho.texto.slice(inserirApos) +
        out.slice(trecho.inicio + trecho.texto.length);
      const doc2 = new DOMParser().parseFromString(comXl, 'text/xml');
      const usps = doc2.getElementsByTagNameNS('*', 'UnsignedSignatureProperties');
      let usp2: any = null;
      for (let i = 0; i < usps.length; i++) {
        const dono: any = usps[i].parentNode?.parentNode?.parentNode;
        if (dono && comXl.slice(trecho.inicio, trecho.inicio + trecho.texto.length + blocoXl.length).includes(`Id="${dono.getAttribute?.('Id')}"`)) usp2 = usps[i];
      }
      if (usp2) {
        const c14n = new ExclusiveCanonicalization().process(usp2, {} as any);
        token = (await obterCarimbo(createHash('sha256').update(Buffer.from(c14n, 'utf8')).digest())).token;
      }
    }
    const sigAndRefs =
      '<xades:SigAndRefsTimeStamp>' +
      `<CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#" xmlns="${NS_DS}" />` +
      (token ? `<xades:EncapsulatedTimeStamp>${token.toString('base64')}</xades:EncapsulatedTimeStamp>` : '') +
      '</xades:SigAndRefsTimeStamp>';
    const novoTrecho =
      trecho.texto.slice(0, inserirApos) + blocoXl + sigAndRefs + trecho.texto.slice(inserirApos);
    out = out.slice(0, trecho.inicio) + novoTrecho + out.slice(trecho.inicio + trecho.texto.length);
    if (!token) avisos.push('SigAndRefsTimeStamp sem token (ACT indisponível no momento).');
  }
  return { xml: out, avisos };
}
