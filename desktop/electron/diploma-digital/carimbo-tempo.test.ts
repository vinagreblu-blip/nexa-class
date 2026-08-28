// ============================================================
// TESTE M4 — Carimbo do tempo (XAdES-T, RFC 3161)
// ============================================================
// Cobertura:
//  - tsa-cliente: requisição DER montada e resposta validada
//    (status granted + nonce confere + genTime extraído)
//  - carimbarAssinaturas: carimba CADA assinatura real (histórico 1×,
//    DA 2×), não mexe nos esqueletos, NÃO invalida as assinaturas
//    (checkSignature continua OK), mantém o XSD válido e o carimbo
//    sobrevive ao transplante da DA para o Diploma final.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assinarTodosEsqueletos, carimbarAssinaturas } from './xades-signer';
import { gerarHistoricoXml } from './gerar-historico-xml';
import { gerarDocumentacaoAcademicaXml } from './gerar-documentacao-academica';
import { gerarDiplomaFinalXml } from './gerar-diploma-xml';
import { validarXmlContraXsd } from './xsd-validator';
import { montarRequisicao, validarResposta } from './tsa-cliente';
import { novoVerificador } from './verificador-teste';

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
const REGISTRADORA = {
  id: 2, nome: 'UNIVERSIDADE REGISTRADORA', codigo_emec: 5678, cnpj: '00.000.000/0001-91',
  logradouro: 'RUA B', numero: '10', complemento: null, bairro: 'CENTRO',
  codigo_municipio: '2927408', nome_municipio: 'Salvador', uf: 'BA', cep: '40010000',
  papel: 'registradora',
  credenciamento_json: '{"tipo":"Decreto","numero":"5","data":"1990-01-01"}',
  mantenedora_json: '{"razaoSocial":"MANTENEDORA X","cnpj":"00.000.000/0001-00","endereco":{"logradouro":"RUA C","bairro":"CENTRO","codigoMunicipio":"2927408","nomeMunicipio":"Salvador","uf":"BA","cep":"40020000"}}',
  ato_autorizacao_registro_json: null,
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

function gerarCertTeste(): { certPem: string; chavePem: string } {
  const forge = require('node-forge');
  const pair = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = pair.publicKey;
  cert.serialNumber = '01' + String(Date.now());
  cert.validity.notBefore = new Date(Date.now() - 86400e3);
  cert.validity.notAfter = new Date(Date.now() + 86400e3 * 365);
  const attrs = [
    { name: 'commonName', value: 'NEXA CLASS TESTE' },
    { name: 'organizationName', value: 'Teste' },
    { name: 'countryName', value: 'BR' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(pair.privateKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), chavePem: forge.pki.privateKeyToPem(pair.privateKey) };
}

/** TSA fake injetável: "carimba" qualquer digest com token determinístico. */
function tsaFake(prefixo = 'TST') {
  let n = 0;
  return async (digest: Buffer) => {
    expect(digest.length).toBe(32);
    n++;
    return { token: Buffer.from(`${prefixo}-TOKEN-${n}-${digest[0]}`), genTime: `2026-08-27T10:0${n}:00Z` };
  };
}

describe('tsa-cliente (RFC 3161)', () => {
  it('monta TimeStampReq DER parseável e valida resposta com nonce/genTime', async () => {
    const forge = require('node-forge');
    const { asn1 } = forge;
    const { der, nonce } = montarRequisicao(Buffer.alloc(32, 7));
    // DER bem-formado: parseia de volta
    const parsed = asn1.fromDer(der.toString('binary'));
    expect(parsed.type).toBe(asn1.Type.SEQUENCE);
    expect(parsed.value.length).toBeGreaterThanOrEqual(4);

    // Resposta sintética: status granted + TSTInfo com genTime e nonce
    const tstInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(1).getBytes()),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.3.4.5').getBytes()),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('2.16.840.1.101.3.4.2.1').getBytes()),
        ]),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, Buffer.alloc(32, 7).toString('binary')),
      ]),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(42).getBytes()),
      asn1.create(asn1.Class.UNIVERSAL, 24, false, '20260827120000Z'), // genTime
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 5, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, nonce.toString('binary')),
      ]),
    ]);
    const resp = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(0).getBytes()),
      ]),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [tstInfo]),
    ]);
    const derResp = Buffer.from(asn1.toDer(resp).getBytes(), 'binary');
    const carimbo = validarResposta(derResp, nonce);
    expect(carimbo.genTime).toBe('2026-08-27T12:00:00Z');
  });

  it('rejeita status de recusa da TSA', () => {
    const forge = require('node-forge');
    const { asn1 } = forge;
    const resp = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(2).getBytes()), // rejection
      ]),
    ]);
    const derResp = Buffer.from(asn1.toDer(resp).getBytes(), 'binary');
    expect(() => validarResposta(derResp, Buffer.alloc(16))).toThrow(/recusou/i);
  });
});

describe('XAdES-T — carimbo no fluxo de assinatura', () => {
  it('carimba o histórico assinado sem invalidar a assinatura nem o XSD', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const snapshot = { processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any;
    const xml = gerarHistoricoXml(snapshot)!;
    const carimbado = await assinarTodosEsqueletos(xml, { chavePem, certPem, carimbador: tsaFake() });
    expect((carimbado.match(/<xades:SignatureTimeStamp/g) ?? []).length).toBe(1);
    // token DER vai em base64 — decodifica e confere o prefixo do mock
    const mTok = /<xades:EncapsulatedTimeStamp>([^<]+)<\/xades:EncapsulatedTimeStamp>/.exec(carimbado)!;
    expect(Buffer.from(mTok[1], 'base64').toString('utf8').startsWith('TST-TOKEN-1-')).toBe(true);

    // Verificação criptográfica continua OK (propriedades NÃO assinadas)
    const { DOMParser } = await import('@xmldom/xmldom');
    const doc = new DOMParser().parseFromString(carimbado, 'text/xml');
    const sig = novoVerificador(certPem, doc.getElementsByTagNameNS('*', 'Signature')[0]);
    expect(sig.checkSignature(carimbado)).toBe(true);

    // XSD oficial continua válido
    const r = await validarXmlContraXsd(carimbado, 'historicoEscolar');
    if (!r.valido) console.error('ERROS XSD:', r.erros);
    expect(r.valido).toBe(true);
  }, 60000);

  it('DA: carimba cada assinatura NA ORDEM certa (raiz cobre a interna carimbada) e o carimbo sobrevive ao Diploma final', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const snapshot = { processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-tst-'));
    const pdf = path.join(tmp, 'rg.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4 fixture');
    try {
      const da = gerarDocumentacaoAcademicaXml(snapshot, [{ caminho: pdf, tipo: 'DocumentoIdentidadeDoAluno' }])!;
      const daCarimbada = await assinarTodosEsqueletos(da, { chavePem, certPem, carimbador: tsaFake() });
      expect((daCarimbada.match(/<xades:SignatureTimeStamp/g) ?? []).length).toBe(2);

      // As duas continuam verificáveis (a raiz assinou SOBRE a interna carimbada)
      const { DOMParser } = await import('@xmldom/xmldom');
      const doc = new DOMParser().parseFromString(daCarimbada, 'text/xml');
      const assinaturas = doc.getElementsByTagNameNS('*', 'Signature');
      for (let i = 0; i < assinaturas.length; i++) {
        const ok = novoVerificador(certPem, assinaturas[i]).checkSignature(daCarimbada);
        if (!ok) {
          for (const rf of novoVerificador(certPem, assinaturas[i]).getReferences()) console.error(`SIG${i} REF`, rf.uri, '→', rf.validationError);
        }
        expect(ok).toBe(true);
      }

      // Diploma final: só a assinatura INTERNA da DA é transplantada (com
      // seu carimbo); a assinatura raiz da DA fica na DA. Esqueletos da
      // registradora NÃO são carimbados → 1 carimbo no Diploma final.
      const final = gerarDiplomaFinalXml(
        snapshot, daCarimbada,
        {
          livro: 'L1', numeroRegistro: '000123',
          dataExpedicaoDiploma: '2026-08-25', dataRegistroDiploma: '2026-08-25',
          responsavel: { nome: 'RESPONSAVEL REGISTRO', cpf: '98765432100' },
          codigoValidacao: '1234.5678.abcdef0123456789',
        },
        REGISTRADORA,
        'VDip' + '1'.repeat(44), 'RDip' + '1'.repeat(44)
      )!;
      expect((final.match(/<xades:SignatureTimeStamp/g) ?? []).length).toBe(1); // a interna da emissora

      // A assinatura carimbada da emissora AINDA verifica dentro do Diploma final
      const docFinal = new DOMParser().parseFromString(final, 'text/xml');
      const sigsFinal = docFinal.getElementsByTagNameNS('*', 'Signature');
      expect(sigsFinal.length).toBe(3);
      expect(novoVerificador(certPem, sigsFinal[0]).checkSignature(final)).toBe(true);

      const r = await validarXmlContraXsd(final, 'diploma');
      if (!r.valido) console.error('ERROS XSD:', r.erros);
      expect(r.valido).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60000);
});
