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
import { assinarProximoEsqueleto, assinarTodosEsqueletos, contarEsqueletos, assinaturasSemCarimbo, tipoPessoaCertPem, avisoCertificadosSemOu, POLITICA_ASSINATURA, POLITICA_ARQUIVAMENTO } from './xades-signer';
import { gerarHistoricoXml } from './gerar-historico-xml';
import { gerarDocumentacaoAcademicaXml } from './gerar-documentacao-academica';
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

    const assinado = await assinarProximoEsqueleto(xml!, { signatureId: 'xmldsig-test01', chavePem, certPem });

    // Estrutura: assinatura real presente
    expect(assinado).toContain('<ds:SignatureValue>');
    expect(assinado).not.toContain('<ds:SignatureValue></ds:SignatureValue>');
    expect(assinado).toContain('SignedProperties');
    expect(assinado).toContain('<ds:X509Certificate>');
    expect(assinado).toContain('<ds:X509SubjectName>');

    // Verificação INDEPENDENTE: xml-crypto valida digests + assinatura RSA
    // (transform enveloped estendido p/ namespace https do MEC — ver helper)
    const { DOMParser } = await import('@xmldom/xmldom');
    const docFinal = new DOMParser().parseFromString(assinado, 'text/xml');
    const sigNode = docFinal.getElementsByTagNameNS('*', 'Signature')[0];
    const sig = novoVerificador(certPem, sigNode);
    const ok = sig.checkSignature(assinado);
    if (!ok) for (const r of sig.getReferences()) console.error('REF', r.uri, '→', r.validationError);
    expect(ok).toBe(true);
    // As duas references (documento + SignedProperties XAdES) válidas
    for (const r of sig.getReferences()) {
      expect(r.validationError ?? null).toBeNull();
    }
  }, 60000);

  it('X509SerialNumber DECIMAL e X509IssuerName .NET', async () => {
    const { certPem, chavePem, serialHex } = gerarCertTeste();
    const xml = gerarHistoricoXml({ processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any);
    const assinado = await assinarProximoEsqueleto(xml!, { signatureId: 'xmldsig-test01', chavePem, certPem });

    // Serial: xs:integer → decimal (forge devolve hex)
    const serialEsperado = BigInt('0x' + serialHex).toString();
    const mSerial = /<X509SerialNumber[^>]*>([^<]+)<\/X509SerialNumber>/.exec(assinado)!;
    expect(mSerial[1]).toBe(serialEsperado);
    expect(mSerial[1]).toMatch(/^\d+$/);

    // IssuerSerial: formato .NET (DN ordem do certificado "TYPE=value,TYPE=value")
    const mIssuer = /<X509IssuerName[^>]*>([^<]+)<\/X509IssuerName>/.exec(assinado)!;
    expect(mIssuer[1]).toMatch(/^CN=NEXA CLASS TESTE,O=Teste,C=BR$/);
  }, 60000);

  it('XML assinado continua VÁLIDO contra o XSD oficial v1.05', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const xml = gerarHistoricoXml({ processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any);
    const assinado = await assinarProximoEsqueleto(xml!, { signatureId: 'xmldsig-test01', chavePem, certPem });
    const r = await validarXmlContraXsd(assinado, 'historicoEscolar');
    if (!r.valido) console.error('ERROS XSD:', r.erros);
    expect(r.valido).toBe(true);
  }, 60000);

  it('alterar UM caractere do documento invalida a assinatura (integridade)', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const xml = gerarHistoricoXml({ processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any);
    const assinado = await assinarProximoEsqueleto(xml!, { signatureId: 'xmldsig-test01', chavePem, certPem });
    const adulterado = assinado.replace('MARIA DA SILVA', 'MARIA DA SILVA X');
    const { DOMParser } = await import('@xmldom/xmldom');
    const docFinal = new DOMParser().parseFromString(adulterado, 'text/xml');
    const sigNode = docFinal.getElementsByTagNameNS('*', 'Signature')[0];
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
      signatureId: 'xmldsig-testa3',
      certPem, // A3: só a parte pública; a chave está "no token" (mock)
      thumbprintA3: 'AABBCC00112233445566778899AABBCCDDEEFF00',
    });

    expect(holder.chamadas).toBe(1); // o digest foi ao "token"
    expect(holder.hashRecebido.length).toBe(32); // SHA-256

    // Verificação independente idêntica à do A1
    const { DOMParser } = await import('@xmldom/xmldom');
    const docFinal = new DOMParser().parseFromString(assinado, 'text/xml');
    const sigNode = docFinal.getElementsByTagNameNS('*', 'Signature')[0];
    const sig = novoVerificador(certPem, sigNode);
    const ok = sig.checkSignature(assinado);
    if (!ok) for (const r of sig.getReferences()) console.error('REF', r.uri, '→', r.validationError);
    expect(ok).toBe(true);
  }, 60000);
});

describe('F1: política de assinatura configurável (XAdES-EPES)', () => {
  it('SEM opção → EPES com a política padrão (PA-AD-RC v2.4) no SignedProperties', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const xml = gerarHistoricoXml({ processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any);
    const assinado = await assinarProximoEsqueleto(xml!, { signatureId: 'xmldsig-testepes', chavePem, certPem });
    expect(assinado).toContain('<xades:SignaturePolicyIdentifier>');
    expect(assinado).toContain(POLITICA_ASSINATURA.identificador);
    expect(assinado).toContain(POLITICA_ASSINATURA.digestBase64);
    expect(assinado).toContain(POLITICA_ASSINATURA.spuri!);
  }, 60000);

  it('politica custom → EPES com identificador/digest/SPURI informados', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const xml = gerarHistoricoXml({ processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any);
    const custom = {
      identificador: 'urn:oid:2.16.76.1.7.1.9.9.9',
      digestBase64: Buffer.alloc(32, 0xAB).toString('base64'),
      spuri: 'http://example.org/politica-teste.xml',
    };
    const assinado = await assinarProximoEsqueleto(xml!, {
      signatureId: 'xmldsig-testepes2', chavePem, certPem, politica: custom,
    });
    expect(assinado).toContain(custom.identificador);
    expect(assinado).toContain(custom.digestBase64);
    expect(assinado).toContain(custom.spuri);
    expect(assinado).not.toContain(POLITICA_ASSINATURA.digestBase64);
  }, 60000);

  it('politica null → XAdES-BES (SEM SignaturePolicyIdentifier)', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const xml = gerarHistoricoXml({ processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any);
    const assinado = await assinarProximoEsqueleto(xml!, {
      signatureId: 'xmldsig-testbes', chavePem, certPem, politica: null,
    });
    expect(assinado).not.toContain('<xades:SignaturePolicyIdentifier>');
    // BES continua com SigningTime + SigningCertificate
    expect(assinado).toContain('<xades:SigningTime>');
    expect(assinado).toContain('<xades:SigningCertificate>');
    // E permanece XSD-válido + criptograficamente verificável
    const r = await validarXmlContraXsd(assinado, 'historicoEscolar');
    expect(r.valido).toBe(true);
    const { DOMParser } = await import('@xmldom/xmldom');
    const docFinal = new DOMParser().parseFromString(assinado, 'text/xml');
    const sigNode = docFinal.getElementsByTagNameNS('*', 'Signature')[0];
    const sig = novoVerificador(certPem, sigNode);
    expect(sig.checkSignature(assinado)).toBe(true);
  }, 60000);
});

describe('M6: leiaute de assinaturas do validador MEC (DA com 3 assinaturas)', () => {
  function gerarDaComPdf(): string {
    // PDF fixture real em tmp (o gerador lê e embute em base64)
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-xades-'));
    const pdf = path.join(tmp, 'rg.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4 fixture');
    return gerarDocumentacaoAcademicaXml(
      { processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any,
      [{ caminho: pdf, tipo: 'DocumentoIdentidadeDoAluno' }]
    )!;
  }

  it('Reference #1 SEM transform XPath — apenas enveloped + c14n (pipeline .NET íntegra)', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const xml = gerarHistoricoXml({ processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any);
    const assinado = await assinarProximoEsqueleto(xml!, { signatureId: 'xmldsig-tx', chavePem, certPem });
    // O transform XPath corrompia o node-set no pipeline do SignedXml .NET
    // (validador oficial) — NÃO deve mais ser declarado.
    expect(assinado).not.toContain('REC-xpath-19991116');
    expect(assinado).not.toContain('<ds:XPath');
    // Transforms declarados: enveloped-signature + c14n inclusivo
    expect(assinado).toContain('xmldsig#enveloped-signature');
    expect(assinado).toContain('REC-xml-c14n-20010315');
  }, 60000);

  it('DA: 3 esqueletos → 3 assinaturas; digest da RAIZ cobre o documento MENOS ela mesma (inclui as internas)', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const da = gerarDaComPdf();
    expect(contarEsqueletos(da)).toBe(3);
    const assinada = await assinarTodosEsqueletos(da, { chavePem, certPem });
    expect(assinada).not.toContain('<ds:SignatureValue></ds:SignatureValue>');

    // Assinatura raiz (arquivamento): Reference URI=""
    const mRefRaiz = /<ds:Reference URI="">[\s\S]*?<ds:DigestValue>([^<]+)<\/ds:DigestValue>/.exec(assinada);
    expect(mRefRaiz).toBeTruthy();
    const declaradoRaiz = mRefRaiz![1];

    // Computa c14n do documentElement MENOS APENAS a assinatura raiz
    // (identificada por conter a Reference URI="") — semântica enveloped
    // padrão que o validador (.NET SignedXml) aplica para URI="".
    const { DOMParser } = await import('@xmldom/xmldom');
    const { C14nCanonicalization } = require('xml-crypto');
    const { createHash } = require('node:crypto');
    const doc = new DOMParser().parseFromString(assinada, 'text/xml');
    const clone = doc.documentElement.cloneNode(true);
    for (let i = 0; i < clone.childNodes.length; i++) {
      const c = clone.childNodes[i];
      if (c.localName === 'Signature' && /<ds:Reference URI="">/.test(c.toString())) {
        clone.removeChild(c);
        i--;
      }
    }
    const c14nMenosSelf = new C14nCanonicalization().process(clone, {});
    const digestMenosSelf = createHash('sha256').update(Buffer.from(c14nMenosSelf, 'utf8')).digest('base64');
    expect(digestMenosSelf).toBe(declaradoRaiz);

    // E NÃO é o digest do documento sem TODAS as assinaturas (era o bug):
    const clone2 = doc.documentElement.cloneNode(true);
    const removerTodas = (el: any) => {
      for (let i = 0; i < el.childNodes.length; i++) {
        const c = el.childNodes[i];
        if (c.localName === 'Signature') { el.removeChild(c); i--; }
        else if (c.nodeType === 1) removerTodas(c);
      }
    };
    removerTodas(clone2);
    const c14nMenosTodas = new C14nCanonicalization().process(clone2, {});
    const digestMenosTodas = createHash('sha256').update(Buffer.from(c14nMenosTodas, 'utf8')).digest('base64');
    expect(digestMenosTodas).not.toBe(declaradoRaiz);
  }, 60000);

  it('posicoes: 3ª assinatura (raiz) com política AD-RA; as internas com a política comum', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const da = gerarDaComPdf();
    const assinada = await assinarTodosEsqueletos(da, {
      chavePem,
      certPem,
      posicoes: [
        { chavePem, certPem }, // herda política padrão (AD-RC)
        { chavePem, certPem }, // herda política padrão (AD-RC)
        { chavePem, certPem, politica: POLITICA_ARQUIVAMENTO }, // AD-RA
      ],
    });
    expect((assinada.split(POLITICA_ASSINATURA.digestBase64).length - 1)).toBe(2);
    expect(assinada).toContain(POLITICA_ARQUIVAMENTO.identificador);
    expect(assinada).toContain(POLITICA_ARQUIVAMENTO.digestBase64);
    expect(assinada).toContain(POLITICA_ARQUIVAMENTO.spuri!);
    // As 3 continuam verificáveis
    const { DOMParser } = await import('@xmldom/xmldom');
    const doc = new DOMParser().parseFromString(assinada, 'text/xml');
    const sigs = doc.getElementsByTagNameNS('*', 'Signature');
    expect(sigs.length).toBe(3);
    for (let i = 0; i < sigs.length; i++) {
      const sig = novoVerificador(certPem, sigs[i]);
      const ok = sig.checkSignature(assinada);
      if (!ok) for (const r of sig.getReferences()) console.error(`POSICOES SIG${i} REF`, r.uri, '→', r.validationError);
      expect(ok).toBe(true);
    }
    // XSD oficial continua válido
    const r = await validarXmlContraXsd(assinada, 'documentacaoAcademica');
    if (!r.valido) console.error('ERROS XSD:', r.erros);
    expect(r.valido).toBe(true);
  }, 60000);

  // ---- Regressão v1.4.14: LTV/carimbo pós-assinatura nas DDs -----
  // Na v1.4.14 a raiz (arquivamento, digest menos-self que COBRE as
  // assinaturas internas) era assinada ANTES do LTV/BRy tocar as DDs —
  // o digest da raiz divergia e o gate final rejeitava
  // ("digests/RSA não conferem"). O fluxo agora é por FASES: as DDs são
  // finalizadas (carimbo+LTV) ANTES da raiz ser criada.

  /** TSA fake determinístico (mesmo padrão do carimbo-tempo.test.ts). */
  function tsaFakeLocal(prefixo = 'TST') {
    let n = 0;
    return async (digest: Buffer) => {
      expect(digest.length).toBe(32);
      n++;
      return { token: Buffer.from(`${prefixo}-TOKEN-${n}-${digest[0]}`), genTime: `2026-09-11T10:0${n}:00Z` };
    };
  }

  it('FLUXO POR FASES (produção): LTV nas DDs antes da raiz → as 3 assinaturas verificam', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const da = gerarDaComPdf();

    // FASE 1: assina as 2 DD (e-CNPJ + e-CPF) com carimbo — só 2 esqueletos
    let xml = await assinarTodosEsqueletos(da, {
      chavePem, certPem, carimbador: tsaFakeLocal(),
      quantidade: 2,
      posicoes: [{ chavePem, certPem }, { chavePem, certPem }],
    });
    expect(contarEsqueletos(xml)).toBe(1); // só a raiz resta

    // FASE 2: aplicarLtv insere blocos DENTRO das DDs (após o carimbo) —
    // a mutação exata que invalidava a raiz na v1.4.14
    xml = xml
      .split('</xades:SignatureTimeStamp>')
      .join('</xades:SignatureTimeStamp><xades:CompleteCertificateRefs><xades:LTV-SIMULADO/></xades:CompleteCertificateRefs>');

    // FASE 3: assinatura de ARQUIVAMENTO (AD-RA) sobre o conteúdo FINAL
    xml = await assinarTodosEsqueletos(xml, {
      chavePem, certPem, carimbador: tsaFakeLocal(),
      posicoes: [{ chavePem, certPem, politica: POLITICA_ARQUIVAMENTO }],
    });
    expect(contarEsqueletos(xml)).toBe(0);
    expect(xml).toContain(POLITICA_ARQUIVAMENTO.identificador);

    // As 3 verificam (motor local independente)
    const { DOMParser } = await import('@xmldom/xmldom');
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const sigs = doc.getElementsByTagNameNS('*', 'Signature');
    expect(sigs.length).toBe(3);
    for (let i = 0; i < sigs.length; i++) {
      const sig = novoVerificador(certPem, sigs[i]);
      const ok = sig.checkSignature(xml);
      if (!ok) for (const r of sig.getReferences()) console.error(`FASES SIG${i} REF`, r.uri, '→', r.validationError);
      expect(ok).toBe(true);
    }
  }, 60000);

  it('CONTRATO: modificar as DDs DEPOIS da raiz assinada invalida a raiz (documenta por que a ordem importa)', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const da = gerarDaComPdf();

    // Ordem ERRADA (v1.4.14): assina TUDO primeiro…
    let xml = await assinarTodosEsqueletos(da, {
      chavePem, certPem, carimbador: tsaFakeLocal(),
      posicoes: [
        { chavePem, certPem },
        { chavePem, certPem },
        { chavePem, certPem, politica: POLITICA_ARQUIVAMENTO },
      ],
    });

    // …e SÓ DEPOIS "aplica LTV" nas DDs (mutação pós-assinatura)
    const raizAntes = xml;
    xml = xml
      .split('</xades:SignatureTimeStamp>')
      .join('</xades:SignatureTimeStamp><xades:CompleteCertificateRefs><xades:LTV-SIMULADO/></xades:CompleteCertificateRefs>');

    // DDs continuam válidas (digest delas exclui TODAS as assinaturas)…
    const { DOMParser } = await import('@xmldom/xmldom');
    const docAntes = new DOMParser().parseFromString(raizAntes, 'text/xml');
    const sigsOrdem = docAntes.getElementsByTagNameNS('*', 'Signature');
    const docDepois = new DOMParser().parseFromString(xml, 'text/xml');
    const sigs = docDepois.getElementsByTagNameNS('*', 'Signature');
    expect(sigs.length).toBe(3);
    expect(novoVerificador(certPem, sigs[0]).checkSignature(xml)).toBe(true);
    expect(novoVerificador(certPem, sigs[1]).checkSignature(xml)).toBe(true);
    // — mas a RAIZ (menos-self, cobre as internas) fica INVÁLIDA — é por
    // isso que o handler finaliza as DDs antes de criar a raiz.
    void sigsOrdem;
    expect(novoVerificador(certPem, sigs[2]).checkSignature(xml)).toBe(false);
  }, 60000);
});

// ============================================================
// v1.4.19 — helpers da política "BRy em todas" + aviso OU nominativo
// ============================================================
describe('assinaturasSemCarimbo (invariante de finalização)', () => {
  const ESQUELETO =
    '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">' +
    '<ds:SignedInfo><ds:Reference URI=""><ds:DigestValue></ds:DigestValue></ds:Reference></ds:SignedInfo>' +
    '<ds:SignatureValue></ds:SignatureValue></ds:Signature>';
  const REAL_SEM_CARIMBO =
    '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="S1">' +
    '<ds:SignedInfo><ds:Reference URI=""><ds:DigestValue>QUJD</ds:DigestValue></ds:Reference></ds:SignedInfo>' +
    '<ds:SignatureValue>UVdG</ds:SignatureValue></ds:Signature>';
  const REAL_COM_CARIMBO =
    '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="S2">' +
    '<ds:SignedInfo><ds:Reference URI=""><ds:DigestValue>QUJD</ds:DigestValue></ds:Reference></ds:SignedInfo>' +
    '<ds:SignatureValue>UVdG</ds:SignatureValue>' +
    '<ds:Object><xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#">' +
    '<xades:UnsignedProperties><xades:UnsignedSignatureProperties>' +
    '<xades:SignatureTimeStamp><xades:EncapsulatedTimeStamp>VE9LRU4=</xades:EncapsulatedTimeStamp></xades:SignatureTimeStamp>' +
    '</xades:UnsignedSignatureProperties></xades:UnsignedProperties>' +
    '</xades:QualifyingProperties></ds:Object></ds:Signature>';

  it('esqueleto não conta; real sem SignatureTimeStamp conta', () => {
    expect(assinaturasSemCarimbo(`<r>${ESQUELETO}</r>`)).toBe(0);
    expect(assinaturasSemCarimbo(`<r>${REAL_SEM_CARIMBO}</r>`)).toBe(1);
  });

  it('real com carimbo zera a pendência (invariante satisfeita)', () => {
    expect(assinaturasSemCarimbo(`<r>${REAL_COM_CARIMBO}${ESQUELETO}</r>`)).toBe(0);
    expect(assinaturasSemCarimbo(`<r>${REAL_COM_CARIMBO}${REAL_COM_CARIMBO}${REAL_SEM_CARIMBO}</r>`)).toBe(1);
  });
});

describe('tipoPessoaCertPem / avisoCertificadosSemOu (aviso nominativo v1.4.19)', () => {
  function gerarCertComOu(ous: string[], cn: string): string {
    const forge = require('node-forge');
    const pair = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = pair.publicKey;
    cert.serialNumber = '01' + String(Date.now()) + Math.floor(Math.random() * 1000);
    cert.validity.notBefore = new Date(Date.now() - 86400e3);
    cert.validity.notAfter = new Date(Date.now() + 86400e3);
    cert.setSubject([
      { name: 'commonName', value: cn },
      ...ous.map((ou) => ({ name: 'organizationalUnitName', value: ou })),
      { name: 'countryName', value: 'BR' },
    ]);
    cert.setIssuer([
      { name: 'commonName', value: cn },
      ...ous.map((ou) => ({ name: 'organizationalUnitName', value: ou })),
      { name: 'countryName', value: 'BR' },
    ]);
    cert.sign(pair.privateKey, forge.md.sha256.create());
    return forge.pki.certificateToPem(cert);
  }

  it('identifica e-CNPJ (CNPJ tem precedência) e e-CPF pelo OU ICP-Brasil', () => {
    expect(tipoPessoaCertPem(gerarCertComOu(['CNPJ: 03.466.601/0001-82', 'CPF: 11122233344'], 'IES LTDA'))).toBe('ecnpj');
    expect(tipoPessoaCertPem(gerarCertComOu(['CPF: 11122233344'], 'RESPONSAVEL'))).toBe('ecpf');
    expect(tipoPessoaCertPem(gerarCertComOu(['TI'], 'SEM OU ICP'))).toBe('desconhecido');
    expect(tipoPessoaCertPem(gerarCertComOu([], 'SEM OU'))).toBe('desconhecido');
  });

  it('v1.4.20 — identifica pelo SUFIXO DO CN (template DOC-ICP-09): casos REAIS de produção', () => {
    // Certificados reais do operador (CN com CNPJ/CPF puro, sem rótulo)
    expect(tipoPessoaCertPem(gerarCertComOu([], 'SOCIEDADE INTEGRAL DE ENSINO SOCIEDADE SIMPLES LT:03466601000182'))).toBe('ecnpj');
    expect(tipoPessoaCertPem(gerarCertComOu([], 'JOSE AUGUSTO MACIEL TORRES:24487287553'))).toBe('ecpf');
    // Rotulados (:CNPJ:/:CPF:) e com pontuação — variação entre ACs
    expect(tipoPessoaCertPem(gerarCertComOu([], 'EMPRESA LTDA:CNPJ:03.466.601/0001-82'))).toBe('ecnpj');
    expect(tipoPessoaCertPem(gerarCertComOu([], 'FULANO DE TAL:CPF:111.222.333-44'))).toBe('ecpf');
    // CN sem identificador numérico → desconhecido
    expect(tipoPessoaCertPem(gerarCertComOu([], 'CERTIFICADO DE TESTE'))).toBe('desconhecido');
  });

  it('avisoCertificadosSemOu: null quando todos identificados; NOMINATIVO (rótulo + CN) quando falta', () => {
    const certIes = gerarCertComOu(['CNPJ: 03.466.601/0001-82'], 'IES LTDA');
    const certResp = gerarCertComOu(['CPF: 11122233344'], 'RESPONSAVEL');
    const certTeste = gerarCertComOu([], 'CERTIFICADO DE TESTE');
    expect(avisoCertificadosSemOu([
      { rotulo: 'da IES (e-CNPJ)', certPem: certIes },
      { rotulo: 'do responsável (e-CPF)', certPem: certResp },
    ])).toBeNull();
    // v1.4.20: certificados identificados pelo CN (produção) TAMBÉM não
    // geram aviso — o falso positivo da v1.4.19 não volta
    expect(avisoCertificadosSemOu([
      { rotulo: 'da IES (e-CNPJ)', certPem: gerarCertComOu([], 'SOCIEDADE INTEGRAL DE ENSINO SOCIEDADE SIMPLES LT:03466601000182') },
      { rotulo: 'do responsável (e-CPF)', certPem: gerarCertComOu([], 'JOSE AUGUSTO MACIEL TORRES:24487287553') },
    ])).toBeNull();
    const aviso = avisoCertificadosSemOu([
      { rotulo: 'da IES (e-CNPJ)', certPem: certIes },
      { rotulo: 'do responsável (e-CPF)', certPem: certTeste },
    ])!;
    expect(aviso).toContain('do responsável (e-CPF) (CN=CERTIFICADO DE TESTE)');
    expect(aviso).not.toContain('da IES');
    expect(aviso).toContain('não traz identificação ICP-Brasil');
    const avisoAmbos = avisoCertificadosSemOu([
      { rotulo: 'da IES (e-CNPJ)', certPem: certTeste },
      { rotulo: 'do responsável (e-CPF)', certPem: certTeste },
    ])!;
    expect(avisoAmbos).toContain(' e ');
    expect(avisoAmbos).toContain('não trazem');
  });
});
