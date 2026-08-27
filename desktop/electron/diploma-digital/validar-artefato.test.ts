// ============================================================
// TESTE — "Validar Diploma Digital" (validador consolidado)
// ============================================================
// Cobre o veredito APROVADO/REJEITADO de ponta a ponta:
//  - artefato assinado + carimbado (token CMS sintético ASSINADO por
//    uma TSA fake com certificado próprio embutido) → APROVADO
//  - sem carimbo → REJEITADO com pendência explícita
//  - token corrompido → carimbo inválido, REJEITADO
//  - documento adulterado → criptografia REJEITADA
//  - XSD inválido → erros estruturados (elemento/linha)
//  - verificação INDEPENDENTE do fluxo (o validador só recebe o XML)
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assinarTodosEsqueletos } from './xades-signer';
import { gerarHistoricoXml } from './gerar-historico-xml';
import { gerarDocumentacaoAcademicaXml } from './gerar-documentacao-academica';
import { validarArtefatoDiploma, estruturarErrosXsd } from './validar-artefato';

const ALUNO = {
  id: 7, matricula: '202012345', nome: 'MARIA DA SILVA', nome_social: null,
  sexo: 'F', nacionalidade: 'Brasileira', naturalidade: 'Salvador',
  naturalidade_codigo_ibge: '2927408', naturalidade_uf: 'BA', naturalidade_estrangeira: null,
  cpf: '123.456.789-00', rg: '1.234.567', rg_uf: 'BA', orgao_emissor: 'SSP-BA',
  data_nascimento: '10/05/2000', curso: 'ADMINISTRAÇÃO', ano_conclusao: '2024',
  ano_ingresso: '2020', data_vestibular: '15/01/2020', data_colacao: '20/12/2024',
  forma_ingresso: 'Vestibular', mae_nome: 'JOANA SILVA', mae_sexo: 'F',
  pai_nome: 'JOAO SILVA', pai_sexo: 'M',
};
const CURSO = {
  id: 3, nome: 'ADMINISTRAÇÃO', codigo_emec: 106513, modalidade: 'Presencial',
  titulo_conferido: 'Bacharel', outro_titulo: null, grau_conferido: 'Bacharelado',
  endereco_json: null, carga_horaria: '3000',
  autorizacao_json: '{"tipo":"Portaria","numero":"10","data":"2010-03-01"}',
  reconhecimento_json: '{"tipo":"Portaria","numero":"20","data":"2015-06-15"}',
};
const IES = {
  id: 1, nome: 'INSTITUTO ERICH FROMM', codigo_emec: 1234, cnpj: '03.466.601/0001-82',
  logradouro: 'AV PRINCIPAL', numero: '100', complemento: null, bairro: 'CENTRO',
  codigo_municipio: '2927408', nome_municipio: 'Salvador', uf: 'BA', cep: '40000000',
  credenciamento_json: '{"tipo":"Portaria","numero":"999","data":"2008-01-15"}',
};
const DISCIPLINAS = [
  { periodo: '1.2020', disciplina: 'ADMINISTRAÇÃO GERAL', docente: 'CARLOS SOUZA', titulacao: 'Doutor', ch: '80H', nota: '9,5', status: 'AP' },
];
const PROCESSO = {
  id: 42, aluno_id: 7, ies_emissora_id: 1,
  chave_acesso: 'Dip' + '1'.repeat(44),
  chave_req: 'ReqDip' + '2'.repeat(44),
  codigo_validacao_historico: null, data_expedicao: null,
};

function gerarCertTeste(cn = 'NEXA CLASS TESTE') {
  const forge = require('node-forge');
  const pair = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = pair.publicKey;
  cert.serialNumber = '01' + String(Date.now());
  cert.validity.notBefore = new Date(Date.now() - 86400e3);
  cert.validity.notAfter = new Date(Date.now() + 86400e3 * 365);
  const attrs = [
    { name: 'commonName', value: cn },
    { name: 'organizationName', value: 'Teste' },
    { name: 'countryName', value: 'BR' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true }]);
  cert.sign(pair.privateKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), chavePem: forge.pki.privateKeyToPem(pair.privateKey), pair, cert };
}

/** Gera um TimeStampToken (CMS) REALMENTE assinado por uma TSA fake com
 *  certificado próprio embutido — o validador faz a verificação completa. */
function tokenCarimboCms(genTimeIso: string): Buffer {
  const forge = require('node-forge');
  const { asn1, pki, md, util } = forge;
  const tsa = gerarCertTeste('ACT TESTE FAKE');
  // TSTInfo: version, policy, messageImprint, serial, genTime
  const genTime = genTimeIso.replace(/[-:TZ]/g, '').slice(0, 14) + 'Z';
  const tstInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(1).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.3.4.5.6').getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('2.16.840.1.101.3.4.2.1').getBytes()),
      ]),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, Buffer.alloc(32, 9).toString('binary')),
    ]),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(777).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, 24, false, genTime),
  ]);
  const tstDer = asn1.toDer(tstInfo).getBytes();
  const d = md.sha256.create();
  d.update(tstDer, 'binary');
  const sig = tsa.pair.privateKey.sign(d);
  // ContentInfo { OID signedData, [0] SignedData }
  const signedData = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(1).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, []),
    // encapContentInfo { OID tstInfo, [0] EXPLICIT OCTET STRING }
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.840.113549.1.9.16.1.4').getBytes()),
      asn1.create(asn1.Class.CONTEXT, 0, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, tstDer),
      ]),
    ]),
    // [0] certs
    asn1.create(asn1.Class.CONTEXT, 0, true, [pki.certificateToAsn1(tsa.cert)]),
    // signerInfos: { version, sid IssuerAndSerial, digestAlg sha256, sigAlg rsa, sig }
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(1).getBytes()),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
          pki.distinguishedNameToAsn1(tsa.cert.issuer),
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(777).getBytes()),
        ]),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('2.16.840.1.101.3.4.2.1').getBytes()),
        ]),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.840.113549.1.1.11').getBytes()),
        ]),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, sig),
      ]),
    ]),
  ]);
  const ci = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.840.113549.1.7.2').getBytes()),
    asn1.create(asn1.Class.CONTEXT, 0, true, [signedData]),
  ]);
  return Buffer.from(asn1.toDer(ci).getBytes(), 'binary');
}

const snapshot = { processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any;

describe('Validar Diploma Digital (consolidado)', () => {
  it('histórico assinado + carimbado (token CMS válido) → APROVADO', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const xml = gerarHistoricoXml(snapshot)!;
    const carimbador = async () => ({ token: tokenCarimboCms('2026-08-27T12:00:00Z') });
    const assinado = await assinarTodosEsqueletos(xml, { signatureIdBase: 'Sign-Hist-42', chavePem, certPem, carimbador });

    const r = await validarArtefatoDiploma(assinado, 'historicoEscolar');
    expect(r.veredito).toBe('APROVADO');
    expect(r.xsd.ok).toBe(true);
    expect(r.assinaturas).toHaveLength(1);
    expect(r.assinaturas[0].criptografiaOk).toBe(true);
    expect(r.assinaturas[0].certDigestOk).toBe(true);
    expect(r.assinaturas[0].carimbo?.tokenOk).toBe(true);
    expect(r.assinaturas[0].carimbo?.genTime).toBe('2026-08-27T12:00:00Z');
    expect(r.assinaturas[0].carimbo?.act).toBeTruthy();
    expect(r.assinaturas[0].certificado?.validoAgora).toBe(true);
    expect(r.assinaturas[0].certificado?.usoAssinaturaDigital).toBe(true);
    expect(r.pendencias).toHaveLength(0);
    expect(r.hashSha256).toMatch(/^[a-f0-9]{64}$/);
  }, 60000);

  it('sem carimbo do tempo → REJEITADO com pendência explícita', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const xml = gerarHistoricoXml(snapshot)!;
    const assinado = await assinarTodosEsqueletos(xml, { signatureIdBase: 'Sign-Hist-42', chavePem, certPem });
    const r = await validarArtefatoDiploma(assinado, 'historicoEscolar');
    expect(r.veredito).toBe('REJEITADO');
    expect(r.pendencias.some((p) => p.includes('Sem carimbo do tempo'))).toBe(true);
  }, 60000);

  it('token de carimbo corrompido → carimbo inválido, REJEITADO', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const xml = gerarHistoricoXml(snapshot)!;
    const carimbador = async () => ({ token: Buffer.from('lixo-nao-e-um-token-cms') });
    const assinado = await assinarTodosEsqueletos(xml, { signatureIdBase: 'Sign-Hist-42', chavePem, certPem, carimbador });
    const r = await validarArtefatoDiploma(assinado, 'historicoEscolar');
    expect(r.veredito).toBe('REJEITADO');
    expect(r.assinaturas[0].carimbo?.tokenOk).toBe(false);
  }, 60000);

  it('documento adulterado pós-assinatura → criptografia REJEITADA', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const xml = gerarHistoricoXml(snapshot)!;
    const carimbador = async () => ({ token: tokenCarimboCms('2026-08-27T12:00:00Z') });
    const assinado = await assinarTodosEsqueletos(xml, { signatureIdBase: 'Sign-Hist-42', chavePem, certPem, carimbador });
    const adulterado = assinado.replace('MARIA DA SILVA', 'MARIA DA SILVA X');
    const r = await validarArtefatoDiploma(adulterado, 'historicoEscolar');
    expect(r.veredito).toBe('REJEITADO');
    expect(r.assinaturas[0].criptografiaOk).toBe(false);
  }, 60000);

  it('DA com DUAS assinaturas carimbadas → APROVADO (validação independente do fluxo)', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-val-'));
    const pdf = path.join(tmp, 'rg.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4 fixture');
    try {
      const da = gerarDocumentacaoAcademicaXml(snapshot, [{ caminho: pdf, tipo: 'DocumentoIdentidadeDoAluno' }])!;
      const carimbador = async () => ({ token: tokenCarimboCms('2026-08-27T12:01:00Z') });
      const assinada = await assinarTodosEsqueletos(da, { signatureIdBase: 'Sign-DD42', chavePem, certPem, carimbador });
      const r = await validarArtefatoDiploma(assinada, 'documentacaoAcademica');
      expect(r.veredito).toBe('APROVADO');
      expect(r.assinaturas).toHaveLength(2);
      expect(r.assinaturas.every((a) => a.carimbo?.tokenOk)).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60000);

  it('erros XSD estruturados (elemento/linha) — não só "XML inválido"', async () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?><Diploma xmlns="https://portal.mec.gov.br/diplomadigital/arquivos-em-xsd" xmlns:ds="http://www.w3.org/2000/09/xmldsig#"/>';
    const r = await validarArtefatoDiploma(xml, 'diploma', { exigirCarimbo: false });
    expect(r.veredito).toBe('REJEITADO');
    expect(r.xsd.ok).toBe(false);
    expect(r.xsd.erros.length).toBeGreaterThan(0);
    // estruturarErrosXsd isola linha/elemento quando o xmllint os informa
    const estr = estruturarErrosXsd(['documento.xml:2: element Diploma: Schemas validity error : falta infDiploma']);
    expect(estr[0].elemento).toBe('Diploma');
    expect(estr[0].linha).toBe(2);
  }, 30000);
});
