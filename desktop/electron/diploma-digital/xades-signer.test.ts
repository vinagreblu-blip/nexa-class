// ============================================================
// TESTE M4 — assinatura XAdES-BES REAL (round-trip verificável)
// ============================================================
// Gera certificado auto-assinado (apenas para TESTE), assina o
// Histórico Escolar Digital e verifica com o xml-crypto
// (checkSignature — motor independente usado para validar XMLDSig)
// além de revalidar o XML assinado contra o XSD OFICIAL.
// Também cobre: conformidade X509 (serial DECIMAL + IssuerSerial
// RFC2253) e o caminho A3 (assinarHashA3 mockado com node:crypto —
// mesma semântica do SignHash do token: PKCS#1 v1.5 sobre o digest).
import { describe, expect, it, vi } from 'vitest';
import { assinarProximoEsqueleto } from './xades-signer';
import { gerarHistoricoXml } from './gerar-historico-xml';
import { validarXmlContraXsd } from './xsd-validator';
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
const DISCIPLINAS = [
  { periodo: '1.2020', disciplina: 'ADMINISTRAÇÃO GERAL', docente: 'CARLOS SOUZA', titulacao: 'Doutor', ch: '80H', nota: '9,5', status: 'AP' },
];
const PROCESSO = { id: 42, aluno_id: 7, ies_emissora_id: 1, chave_acesso: null, codigo_validacao_historico: null, data_expedicao: null };

/** Certificado X509 auto-assinado APENAS PARA TESTE (não é ICP-Brasil). */
function gerarCertTeste(): { certPem: string; chavePem: string; serialHex: string } {
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
  cert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true }]);
  cert.sign(pair.privateKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    chavePem: forge.pki.privateKeyToPem(pair.privateKey),
    serialHex: cert.serialNumber,
  };
}

// ---- Mock do caminho A3: assinarHashA3 no lugar do PowerShell/SignHash.
// Mesma semântica do RSACryptoServiceProvider.SignHash(SHA256, Pkcs1):
// monta o DigestInfo DER (header SHA-256 || hash) e aplica PKCS#1 v1.5
// — privateEncrypt com RSA_PKCS1_PADDING É a primitiva RSASSA-PKCS1-v1_5
// (bloco type-1, comprovado igual ao forge.sign no teste).
const holder = vi.hoisted(() => ({
  chavePem: '',
  chamadas: 0,
  hashRecebido: Buffer.alloc(0),
  digestInfo: Buffer.from('3031300d060960864801650304020105000420', 'hex'),
}));
vi.mock('../ipc/assinatura', () => ({
  assinarHashA3: async (_thumbprint: string, hash: Buffer): Promise<Buffer> => {
    const { createPrivateKey, privateEncrypt, constants } = await import('node:crypto');
    holder.chamadas++;
    holder.hashRecebido = Buffer.from(hash);
    const key = createPrivateKey(holder.chavePem);
    return privateEncrypt(
      { key, padding: constants.RSA_PKCS1_PADDING },
      Buffer.concat([holder.digestInfo, hash]),
    );
  },
}));

describe('M4: assinatura XAdES-BES real (A1, verificável)', () => {
  it('assina o Histórico Escolar Digital e PASSA na verificação independente (xml-crypto)', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const xml = gerarHistoricoXml({ processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any);
    expect(xml).toBeTruthy();

    const assinado = await assinarProximoEsqueleto(xml!, { signatureId: 'Sign-Hist-42', chavePem, certPem });

    // Estrutura: assinatura real presente
    expect(assinado).toContain('<ds:SignatureValue>');
    expect(assinado).not.toContain('<ds:SignatureValue></ds:SignatureValue>');
    expect(assinado).toContain('xades:SignedProperties');
    expect(assinado).toContain('<ds:X509Certificate>');

    // Verificação INDEPENDENTE: xml-crypto valida digests + assinatura RSA
    // (transform enveloped estendido p/ namespace https do MEC — ver helper)
    const { DOMParser } = await import('@xmldom/xmldom');
    const docFinal = new DOMParser().parseFromString(assinado, 'text/xml');
    const sigNode = docFinal.getElementsByTagName('ds:Signature')[0];
    const sig = novoVerificador(certPem, sigNode);
    const ok = sig.checkSignature(assinado);
    if (!ok) for (const r of sig.getReferences()) console.error('REF', r.uri, '→', r.validationError);
    expect(ok).toBe(true);
    // As duas references (documento + SignedProperties XAdES) válidas
    for (const r of sig.getReferences()) {
      expect(r.validationError ?? null).toBeNull();
    }
  }, 60000);

  it('X509SerialNumber DECIMAL e X509IssuerName RFC2253 (ordem invertida)', async () => {
    const { certPem, chavePem, serialHex } = gerarCertTeste();
    const xml = gerarHistoricoXml({ processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any);
    const assinado = await assinarProximoEsqueleto(xml!, { signatureId: 'Sign-Hist-42', chavePem, certPem });

    // Serial: xs:integer → decimal (forge devolve hex)
    const serialEsperado = BigInt('0x' + serialHex).toString();
    expect(assinado).toContain(`<X509SerialNumber>${serialEsperado}</X509SerialNumber>`);
    expect(assinado).not.toContain(`<X509SerialNumber>${serialHex}</X509SerialNumber>`);
    const mSerial = /<X509SerialNumber>([^<]+)<\/X509SerialNumber>/.exec(assinado)!;
    expect(mSerial[1]).toMatch(/^\d+$/);

    // IssuerSerial RFC2253: ordem INVERSA do ASN.1 ([CN,O,C] → C,O,CN)
    expect(assinado).toContain('<X509IssuerName>C=BR,O=Teste,CN=NEXA CLASS TESTE</X509IssuerName>');
  }, 60000);

  it('XML assinado continua VÁLIDO contra o XSD oficial v1.05', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const xml = gerarHistoricoXml({ processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any);
    const assinado = await assinarProximoEsqueleto(xml!, { signatureId: 'Sign-Hist-42', chavePem, certPem });
    const r = await validarXmlContraXsd(assinado, 'historicoEscolar');
    if (!r.valido) console.error('ERROS XSD:', r.erros);
    expect(r.valido).toBe(true);
  }, 60000);

  it('alterar UM caractere do documento invalida a assinatura (integridade)', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const xml = gerarHistoricoXml({ processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any);
    const assinado = await assinarProximoEsqueleto(xml!, { signatureId: 'Sign-Hist-42', chavePem, certPem });
    const adulterado = assinado.replace('MARIA DA SILVA', 'MARIA DA SILVA X');
    const { DOMParser } = await import('@xmldom/xmldom');
    const docFinal = new DOMParser().parseFromString(adulterado, 'text/xml');
    const sigNode = docFinal.getElementsByTagName('ds:Signature')[0];
    const sig = novoVerificador(certPem, sigNode);
    let ok = true;
    try { ok = sig.checkSignature(adulterado); } catch { ok = false; }
    expect(ok).toBe(false);
  }, 60000);
});

describe('M4: caminho A3 (thumbprintA3 → assinarHashA3/SignHash)', () => {
  it('assina pelo token (mock) com o mesmo resultado verificável do A1', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    holder.chavePem = chavePem;
    holder.chamadas = 0;
    const xml = gerarHistoricoXml({ processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any);

    const assinado = await assinarProximoEsqueleto(xml!, {
      signatureId: 'Sign-Hist-A3',
      certPem, // A3: só a parte pública; a chave está "no token" (mock)
      thumbprintA3: 'AABBCC00112233445566778899AABBCCDDEEFF00',
    });

    expect(holder.chamadas).toBe(1); // o digest foi ao "token"
    expect(holder.hashRecebido.length).toBe(32); // SHA-256

    // Verificação independente idêntica à do A1
    const { DOMParser } = await import('@xmldom/xmldom');
    const docFinal = new DOMParser().parseFromString(assinado, 'text/xml');
    const sigNode = docFinal.getElementsByTagName('ds:Signature')[0];
    const sig = novoVerificador(certPem, sigNode);
    const ok = sig.checkSignature(assinado);
    if (!ok) for (const r of sig.getReferences()) console.error('REF', r.uri, '→', r.validationError);
    expect(ok).toBe(true);
  }, 60000);
});
