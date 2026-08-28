// ============================================================
// CRL — parse e verificação (RFC 5280 CertificateList)
// ============================================================
// Gera CA + intermediária + leaf em memória (node-forge) e monta CRLs
// REAIS (assinadas) para provar: parse (issuer/thisUpdate/serials/
// crlNumber), verificação da assinatura da CRL contra o emissor certo
// (e rejeição contra cert errado) e checagem de revogação por serial.
import { describe, expect, it } from 'vitest';
import { parsearCrl, verificarAssinaturaCrl, verificarRevogacao, emissorDaCrl } from './crl';

function par(titulo: string) {
  const forge = require('node-forge');
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + titulo.length + String(Date.now()).slice(-8);
  cert.validity.notBefore = new Date(Date.now() - 86400e3);
  cert.validity.notAfter = new Date(Date.now() + 86400e3 * 365);
  const attrs = [{ name: 'commonName', value: titulo }, { name: 'organizationName', value: 'Teste CRL' }, { name: 'countryName', value: 'BR' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([{ name: 'basicConstraints', cA: true }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { keys, cert };
}

function emitidaPor(issuer: { keys: any; cert: any }, titulo: string, serialHex: string) {
  const forge = require('node-forge');
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serialHex;
  cert.validity.notBefore = new Date(Date.now() - 86400e3);
  cert.validity.notAfter = new Date(Date.now() + 86400e3 * 365);
  cert.setSubject([{ name: 'commonName', value: titulo }]);
  // issuer DN copiado do certificado emissor
  cert.setIssuer((issuer.cert.subject as any).attributes);
  cert.setExtensions([{ name: 'basicConstraints', cA: false }]);
  cert.sign(issuer.keys.privateKey, forge.md.sha256.create());
  return { keys, cert };
}

function utc(d: Date): string {
  const forge = require('node-forge');
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const yy = d.getUTCFullYear();
  const v = `${p(yy % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return v;
}

/** Monta um CertificateList DER assinado (estrutura RFC 5280 manual). */
function montarCrl(
  emissor: { keys: any; cert: any },
  revogados: { serialHex: string; quando: Date }[],
  comNumero: string | null,
  thisUpdate = new Date(),
  nextUpdate = new Date(Date.now() + 7 * 86400e3)
): Buffer {
  const forge = require('node-forge');
  const { asn1 } = forge;
  const issuerAsn = forge.pki.certificateToAsn1(emissor.cert);
  const tbsCert = issuerAsn.value[0];
  const comVersao = tbsCert.value[0]?.typeClass === asn1.Class.CONTEXT;
  const nameEmissor = tbsCert.value[comVersao ? 5 : 4]; // SUBJECT do emissor
  const campos: any[] = [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, '\u0001'), // version v2
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.840.113549.1.1.11').getBytes()),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
    ]),
    nameEmissor,
    asn1.create(asn1.Class.UNIVERSAL, 23, false, utc(thisUpdate)),
    asn1.create(asn1.Class.UNIVERSAL, 23, false, utc(nextUpdate)),
  ];
  if (revogados.length) {
    campos.push(
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, revogados.map((r) =>
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, forge.util.hexToBytes(r.serialHex)),
          asn1.create(asn1.Class.UNIVERSAL, 23, false, utc(r.quando)),
        ])
      ))
    );
  }
  if (comNumero !== null) {
    const numeroInt = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, forge.util.hexToBytes(comNumero));
    const ext = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('2.5.29.20').getBytes()),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, asn1.toDer(numeroInt).getBytes()),
    ]);
    campos.push(
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [ext]),
      ])
    );
  }
  const tbs = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, campos);
  const tbsDer = asn1.toDer(tbs).getBytes();
  const md = forge.md.sha256.create();
  md.update(tbsDer, 'binary');
  const sig = emissor.keys.privateKey.sign(md);
  const topo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    tbs,
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.840.113549.1.1.11').getBytes()),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
    ]),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.BITSTRING, false, '\u0000' + sig),
  ]);
  return Buffer.from(asn1.toDer(topo).getBytes(), 'binary');
}

function pemCert(cert: any): string {
  return require('node-forge').pki.certificateToPem(cert);
}

describe('F3: CRL — parse e verificação', () => {
  it('parseia issuer/thisUpdate/nextUpdate/serials/crlNumber e valida assinatura contra o emissor', () => {
    const ca = par('AC RAIZ TESTE');
    const serialRevogado = '00ABCD1234EF567890';
    const crl = montarCrl(ca, [{ serialHex: serialRevogado, quando: new Date() }], '2A');
    const info = parsearCrl(crl);
    expect(info.issuerDn).toContain('CN=AC RAIZ TESTE');
    expect(info.thisUpdate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(info.nextUpdate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(info.crlNumber).toBe('42'); // 0x2A
    expect(info.hashAlgoritmo).toBe('sha256');
    expect(info.revogados).toContain(BigInt('0x' + serialRevogado).toString());
    // Assinatura confere com a CA…
    expect(verificarAssinaturaCrl(info, pemCert(ca.cert))).toBe(true);
  }, 30000);

  it('rejeita CRL "emitida" por certificado que NÃO é o emissor', () => {
    const ca = par('AC RAIZ TESTE');
    const outra = par('AC INTRUSA');
    const crl = montarCrl(ca, [], null);
    const info = parsearCrl(crl);
    expect(verificarAssinaturaCrl(info, pemCert(outra.cert))).toBe(false);
    expect(emissorDaCrl(info, [pemCert(outra.cert), pemCert(ca.cert)])).toBe(pemCert(ca.cert));
  }, 30000);

  it('verificarRevogacao: REVOGADO por serial, VALIDO sem o serial, CRL vencida = indeterminado', () => {
    const ca = par('AC RAIZ TESTE');
    const leaf = emitidaPor(ca, 'TSA TESTE', '00FF11AA');
    const leafPem = pemCert(leaf.cert);
    const serial = BigInt('0x' + '00FF11AA').toString();
    const caPem = pemCert(ca.cert);

    const revogada = montarCrl(ca, [{ serialHex: '00FF11AA', quando: new Date() }], '01');
    const r1 = verificarRevogacao(leafPem, revogada, caPem);
    expect(r1.status).toBe('revogado');
    expect(r1.detalhe).toContain(serial);

    const limpa = montarCrl(ca, [], '02');
    const r2 = verificarRevogacao(leafPem, limpa, caPem);
    expect(r2.status).toBe('valido');

    // CRL vencida (nextUpdate no passado): monta manualmente com datas velhas
    const vencida = montarCrl(ca, [], null, new Date(Date.now() - 30 * 86400e3), new Date(Date.now() - 7 * 86400e3));
    const r3 = verificarRevogacao(leafPem, vencida, caPem);
    expect(r3.status).toBe('indeterminado');
    expect(r3.detalhe).toContain('vencida');
  }, 30000);

  it('cadeia multi-nível: CRL da intermediária verifica, DN legível por nível', () => {
    const raiz = par('AC RAIZ');
    const inter = emitidaPor(raiz, 'AC INTERMEDIARIA', '00CC');
    const leaf = emitidaPor(inter, 'TSA FINAL', '00DD');
    const crlInter = montarCrl(inter, [], '05');
    const info = parsearCrl(crlInter);
    expect(info.issuerDn).toContain('CN=AC INTERMEDIARIA');
    const r = verificarRevogacao(pemCert(leaf.cert), crlInter, pemCert(inter.cert));
    expect(r.status).toBe('valido');
  }, 30000);
});
