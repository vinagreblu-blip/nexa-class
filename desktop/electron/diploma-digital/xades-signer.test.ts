// ============================================================
// TESTE M4 — assinatura XAdES-BES REAL (round-trip verificável)
// ============================================================
// Gera certificado auto-assinado (apenas para TESTE), assina o
// Histórico Escolar Digital e verifica com o xml-crypto
// (checkSignature — motor independente usado para validar XMLDSig)
// além de revalidar o XML assinado contra o XSD OFICIAL.
import { describe, expect, it } from 'vitest';
import { SignedXml } from 'xml-crypto';
import { assinarProximoEsqueleto } from './xades-signer';
import { gerarHistoricoXml } from './gerar-historico-xml';
import { validarXmlContraXsd } from './xsd-validator';

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
const PROCESSO = { id: 42, aluno_id: 7, ies_emissora_id: 1, chave_acesso: null, codigo_validacao_historico: null, data_expedicao: null };

/** Certificado X509 auto-assinado APENAS PARA TESTE (não é ICP-Brasil). */
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
    { shortName: 'OU', value: 'TI' },
    { name: 'countryName', value: 'BR' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true }]);
  cert.sign(pair.privateKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), chavePem: forge.pki.privateKeyToPem(pair.privateKey) };
}

describe('M4: assinatura XAdES-BES real (A1, verificável)', () => {
  it('assina o Histórico Escolar Digital e PASSA na verificação independente (xml-crypto)', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const xml = gerarHistoricoXml({ processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any);
    expect(xml).toBeTruthy();

    const assinado = assinarProximoEsqueleto(xml!, { signatureId: 'Sign-Hist-42', chavePem, certPem });

    // Estrutura: assinatura real presente
    expect(assinado).toContain('<ds:SignatureValue>');
    expect(assinado).not.toContain('<ds:SignatureValue></ds:SignatureValue>');
    expect(assinado).toContain('xades:SignedProperties');
    expect(assinado).toContain('<ds:X509Certificate>');

    // Verificação INDEPENDENTE: xml-crypto valida digests + assinatura RSA
    const { DOMParser } = await import('@xmldom/xmldom');
    const docFinal = new DOMParser().parseFromString(assinado, 'text/xml');
    const sigNode = docFinal.getElementsByTagName('ds:Signature')[0];
    const sig = new SignedXml({ publicCert: certPem });
    sig.loadSignature(sigNode);
    let ok = false;
    try { ok = sig.checkSignature(assinado); } catch (e) { console.error('EXC:', (e as Error).message); }
    expect(ok).toBe(true);
    // As duas references (documento + SignedProperties XAdES) válidas
    for (const r of sig.getReferences()) {
      expect(r.validationError ?? null).toBeNull();
    }
  }, 60000);

  it('XML assinado continua VÁLIDO contra o XSD oficial v1.05', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const xml = gerarHistoricoXml({ processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any);
    const assinado = assinarProximoEsqueleto(xml!, { signatureId: 'Sign-Hist-42', chavePem, certPem });
    const r = await validarXmlContraXsd(assinado, 'historicoEscolar');
    if (!r.valido) console.error('ERROS XSD:', r.erros);
    expect(r.valido).toBe(true);
  }, 60000);

  it('alterar UM caractere do documento invalida a assinatura (integridade)', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const xml = gerarHistoricoXml({ processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any);
    const assinado = assinarProximoEsqueleto(xml!, { signatureId: 'Sign-Hist-42', chavePem, certPem });
    const adulterado = assinado.replace('MARIA DA SILVA', 'MARIA DA SILVA X');
    const { DOMParser } = await import('@xmldom/xmldom');
    const docFinal = new DOMParser().parseFromString(adulterado, 'text/xml');
    const sigNode = docFinal.getElementsByTagName('ds:Signature')[0];
    const sig = new SignedXml({ publicCert: certPem });
    sig.loadSignature(sigNode);
    let ok = true;
    try { ok = sig.checkSignature(adulterado); } catch { ok = false; }
    expect(ok).toBe(false);
  }, 60000);
});
