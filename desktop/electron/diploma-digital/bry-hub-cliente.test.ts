import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  limparCacheBry,
  obterTokenBry,
  testarConexaoBry,
  upgradeCarimboBry,
  finalizarCarimbosBry,
  enxertarCarimbosBry,
  URL_AUTH_BRY_PADRAO,
  URL_HUB_BRY_PRODUCAO,
  type ConfigBryHub,
} from './bry-hub-cliente';

// ============================================================
// Cliente BRy HUB — token OAuth2 (com cache) + upgrade TIMESTAMP.
// Sem rede: fetch global mockado por teste (vi.stubGlobal).
// Endpoints validados em 04/09/2026 contra os ambientes oficiais:
//   POST cloud.bry.com.br/token-service/jwt → {access_token, expires_in}
//   POST {hub}/xml/v1/upgrade/signature → [{status:200, document: base64}]
//   GET  {hub}/infos → {version, rateLimit}
// ============================================================

const CFG: ConfigBryHub = {
  urlAuth: URL_AUTH_BRY_PADRAO,
  clientId: 'app-teste',
  clientSecret: 'secret-teste',
  urlHub: URL_HUB_BRY_PRODUCAO,
};

function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  limparCacheBry();
});

describe('obterTokenBry (POST token-service/jwt)', () => {
  it('troca client_id/secret por JWT e guarda no cache', async () => {
    const chamadas: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push(String(url));
        void init;
        return respostaJson({ access_token: 'AAA.BBB.CCC', expires_in: 14400 });
      })
    );
    const t1 = await obterTokenBry(CFG);
    const t2 = await obterTokenBry(CFG); // cache — não refaz POST
    expect(t1).toBe('AAA.BBB.CCC');
    expect(t2).toBe(t1);
    expect(chamadas).toHaveLength(1);
    // corpo OAuth2 padrão
    const init = (fetch as any).mock.calls[0][1] as RequestInit;
    expect(String(init.body)).toContain('grant_type=client_credentials');
    expect(String(init.body)).toContain('client_id=app-teste');
  });

  it('401 → mensagem orienta conferir o secret (o reemitido invalida o anterior)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respostaJson({ status_code: 401, message: 'unauthorized' }, 401))
    );
    await expect(obterTokenBry(CFG)).rejects.toThrow(/401.*Client ID\/Client Secret/i);
  });

  it('campos obrigatórios validados antes da rede', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(obterTokenBry({ ...CFG, clientId: '' })).rejects.toThrow(/Client ID/i);
  });
});

describe('testarConexaoBry (GET /infos — não consome créditos)', () => {
  it('retorna versão do HUB e tamanho do token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('token-service')) {
          return respostaJson({ access_token: 'TOK', expires_in: 1000 });
        }
        expect(String(url)).toBe('https://hub2.bry.com.br/infos');
        return respostaJson({ version: '3.8.2', rateLimit: '15' });
      })
    );
    const r = await testarConexaoBry(CFG);
    expect(r.versaoHub).toBe('3.8.2');
    expect(r.tokenChars).toBe(3);
  });
});

describe('upgradeCarimboBry (POST /xml/v1/upgrade/signature)', () => {
  // Fixture com UMA assinatura real (Id + SignedInfo + QualifyingProperties).
  const XML_BES =
    '<raiz xmlns="urn:teste">' +
    '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="xmldsig-1">' +
    '<ds:SignedInfo>' +
    '<ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>' +
    '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>' +
    '<ds:Reference URI=""><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>ZEhBQQ==</ds:DigestValue></ds:Reference>' +
    '</ds:SignedInfo>' +
    '<ds:SignatureValue>QUJD</ds:SignatureValue>' +
    '<ds:Object><xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="#xmldsig-1">' +
    '<xades:SignedProperties Id="xmldsig-1-signed-properties"></xades:SignedProperties>' +
    '</xades:QualifyingProperties></ds:Object>' +
    '</ds:Signature></raiz>';

  /** Simula a resposta da BRy: re-serialização com prefixos renomeados
   *  (ds141:/xades141: — como o motor deles faz) + carimbo adicionado. */
  function respostaBryLike(xml: string): string {
    return xml
      .replaceAll('xmlns:ds="', 'xmlns:ds141="').replaceAll('<ds:', '<ds141:').replaceAll('</ds:', '</ds141:')
      .replaceAll('xmlns:xades="', 'xmlns:xades141="').replaceAll('<xades:', '<xades141:').replaceAll('</xades:', '</xades141:')
      .replace(
        '</xades141:QualifyingProperties>',
        '<xades141:UnsignedProperties><xades141:UnsignedSignatureProperties>' +
        '<xades141:SignatureTimeStamp Id="ts-1">' +
        '<ds141:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>' +
        '<xades141:EncapsulatedTimeStamp>TOKEN</xades141:EncapsulatedTimeStamp>' +
        '</xades141:SignatureTimeStamp>' +
        '</xades141:UnsignedSignatureProperties></xades141:UnsignedProperties></xades141:QualifyingProperties>'
      );
  }

  function mockComToken(respostaUpgrade: () => Promise<Response>) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('token-service')) {
        return respostaJson({ access_token: 'TOK', expires_in: 1000 });
      }
      return respostaUpgrade();
    }));
  }

  it('status 200 + document base64 → ORIGINAL preservado com o carimbo ENXERTADO (nunca o XML da BRy)', async () => {
    mockComToken(async () =>
      respostaJson([{ status: 200, timestamp: Date.now(), document: Buffer.from(respostaBryLike(XML_BES)).toString('base64') }])
    );
    const r = await upgradeCarimboBry(CFG, XML_BES);
    // Original + bloco com NOSSOS prefixos; nada de re-serialização BRy
    expect(r.xml.startsWith('<raiz xmlns="urn:teste"><ds:Signature ')).toBe(true);
    expect(r.xml).toContain('<xades:EncapsulatedTimeStamp>TOKEN</xades:EncapsulatedTimeStamp>');
    expect(r.xml).not.toContain('xades141');
    expect(r.xml).toContain('<ds:SignatureValue>QUJD</ds:SignatureValue>');
    expect(r.carimbosAdicionados).toBe(1);
  });

  it('usa profile=TIMESTAMP e returnType=BASE64 no multipart', async () => {
    mockComToken(async () =>
      respostaJson([{ status: 200, document: Buffer.from(respostaBryLike(XML_BES)).toString('base64') }])
    );
    const espiao = fetch as any;
    await upgradeCarimboBry(CFG, XML_BES);
    const init = espiao.mock.calls.find((c: any[]) => String(c[0]).includes('upgrade'))?.[1] as RequestInit;
    const fd = init.body as unknown as FormData;
    expect(String(fd.get('profile'))).toBe('TIMESTAMP');
    expect(String(fd.get('returnType'))).toBe('BASE64');
    expect(fd.get('signature[0]')).toBeTruthy();
  });

  it('item com status≠200 → erro com chave/message da BRy', async () => {
    mockComToken(async () =>
      respostaJson(
        [{ status: 400, chave: 'excecao.signer.erro', message: 'certificado expirado' }],
        400
      )
    );
    await expect(upgradeCarimboBry(CFG, XML_BES)).rejects.toThrow(/certificado expirado.*\[excecao\.signer\.erro\]|BRy HUB não carimbou/s);
  });

  it('HTTP 401 → renova token (limpa cache) e retenta UMA vez', async () => {
    let tentativas = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('token-service')) {
        return respostaJson({ access_token: 'TOK', expires_in: 1000 });
      }
      tentativas++;
      if (tentativas === 1) return respostaJson({ message: 'jwt expired' }, 401);
      return respostaJson([{ status: 200, document: Buffer.from(respostaBryLike(XML_BES)).toString('base64') }]);
    }));
    const r = await upgradeCarimboBry(CFG, XML_BES);
    expect(r.xml).toContain('<xades:EncapsulatedTimeStamp>TOKEN</xades:EncapsulatedTimeStamp>');
    expect(r.xml).not.toContain('xades141');
    expect(tentativas).toBe(2);
  });

  it('timeout → mensagem específica', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw Object.assign(new Error('timed out'), { name: 'AbortError' });
    }));
    await expect(upgradeCarimboBry(CFG, XML_BES, 10)).rejects.toThrow(/timeout|rede/i);
  });
});

// ============================================================
// ENXERTO CIRÚRGICO — regressão real do validador XMLDSig
// ============================================================
// A BRy re-serializa o documento inteiro (prefixos renomeados). O digest
// da assinatura raiz (URI="") COBRE as assinaturas internas: adotar o
// documento devolvido quebrava o DigestValue → gate "digests/RSA não
// conferem". O enxerto copia SOMENTE os SignatureTimeStamp adicionados,
// por cirurgia de string, preservando todo o restante do XML original.

// ---------- fixtures/helpers compartilhados (DA + BRy-like) ----------
const ALUNO = {
    id: 7, matricula: '202012345', nome: 'MARIA DA SILVA', nome_social: null, sexo: 'F',
    nacionalidade: 'Brasileira', naturalidade: 'Salvador', naturalidade_codigo_ibge: '2927408',
    naturalidade_uf: 'BA', naturalidade_estrangeira: null, cpf: '123.456.789-00', rg: '1.234.567',
    rg_uf: 'BA', orgao_emissor: 'SSP-BA', data_nascimento: '10/05/2000', curso: 'ADMINISTRAÇÃO',
    ano_conclusao: '2024', ano_ingresso: '2020', data_vestibular: '15/01/2020', data_colacao: '20/12/2024',
    forma_ingresso: 'Vestibular', mae_nome: 'JOANA SILVA', mae_sexo: 'F', pai_nome: 'JOAO SILVA', pai_sexo: 'M',
  };
  const CURSO = {
    id: 3, nome: 'ADMINISTRAÇÃO', codigo_emec: 106513, modalidade: 'Presencial', titulo_conferido: 'Bacharel',
    outro_titulo: null, grau_conferido: 'Bacharelado', endereco_json: null, carga_horaria: '3000',
    autorizacao_json: '{"tipo":"Portaria","numero":"10","data":"2010-03-01"}',
    reconhecimento_json: '{"tipo":"Portaria","numero":"20","data":"2015-06-15"}',
  };
  const IES = {
    id: 1, nome: 'INSTITUTO ERICH FROMM', codigo_emec: 1234, cnpj: '03.466.601/0001-82', logradouro: 'AV PRINCIPAL',
    numero: '100', complemento: null, bairro: 'CENTRO', codigo_municipio: '2927408', nome_municipio: 'Salvador',
    uf: 'BA', cep: '40000000', credenciamento_json: '{"tipo":"Portaria","numero":"999","data":"2008-01-15"}',
  };
  const DISCIPLINAS = [{ periodo: '1.2020', disciplina: 'ADMINISTRAÇÃO GERAL', docente: 'CARLOS SOUZA', titulacao: 'Doutor', ch: '80H', nota: '9,5', status: 'AP' }];
  const PROCESSO = { id: 42, aluno_id: 7, ies_emissora_id: 1, chave_acesso: 'Dip' + '1'.repeat(44), chave_req: 'ReqDip' + '2'.repeat(44) };

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
    cert.setSubject(attrs); cert.setIssuer(attrs);
    cert.sign(pair.privateKey, forge.md.sha256.create());
    return { certPem: forge.pki.certificateToPem(cert), chavePem: forge.pki.privateKeyToPem(pair.privateKey) };
  }

  /** DA recém-gerada (3 esqueletos) + credencial de teste. */
  async function daBase(): Promise<{ da: string; certPem: string; chavePem: string }> {
    const { gerarDocumentacaoAcademicaXml } = await import('./gerar-documentacao-academica');
    const { certPem, chavePem } = gerarCertTeste();
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-bry-'));
    const pdf = path.join(tmp, 'rg.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4 fixture');
    try {
      const da = gerarDocumentacaoAcademicaXml(
        { processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any,
        [{ caminho: pdf, tipo: 'DocumentoIdentidadeDoAluno' }]
      )!;
      return { da, certPem, chavePem };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  /** Simula a resposta REAL da BRy: o conteúdo existente é preservado
   *  (por isso os digests #Dip/#SignedProperties das internas seguem
   *  válidos) e os nós ADICIONADOS vêm com prefixos próprios do
   *  serializer dela (xades141/ds141, com xmlns declarado localmente —
   *  é exatamente esse padrão que o código de produção já esperava).
   *  Isso quebra APENAS o digest da raiz URI="" (que cobre as internas
   *  — bytes novos dentro delas). Carimba todas, ou só as `soInternas`
   *  primeiras (FASE 2). */
  function bryLike(xml: string, token = 'Q01TLVRPS0VO', soInternas = false): string {
    const carimbo =
      '<xades141:UnsignedProperties xmlns:xades141="http://uri.etsi.org/01903/v1.3.2#">' +
      '<xades141:UnsignedSignatureProperties>' +
      '<xades141:SignatureTimeStamp>' +
      '<ds141:CanonicalizationMethod xmlns:ds141="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>' +
      `<xades141:EncapsulatedTimeStamp>${token}</xades141:EncapsulatedTimeStamp>` +
      '</xades141:SignatureTimeStamp>' +
      '</xades141:UnsignedSignatureProperties></xades141:UnsignedProperties>';
    const blocosQP = xml.match(/<xades:QualifyingProperties[\s\S]*?<\/xades:QualifyingProperties>/g) ?? [];
    let out = xml;
    let processadas = 0;
    for (const qp of blocosQP) {
      processadas++;
      if (soInternas && processadas > 2) break; // FASE 2: só as internas
      const novoQp = qp.includes('</xades:UnsignedSignatureProperties>')
        ? qp.replace('</xades:UnsignedSignatureProperties>',
            carimbo.replace('<xades141:UnsignedProperties xmlns:xades141="http://uri.etsi.org/01903/v1.3.2#">', '')
                   .replace('</xades141:UnsignedProperties>', '') +
            '</xades:UnsignedSignatureProperties>')
        : qp.replace('</xades:QualifyingProperties>', carimbo + '</xades:QualifyingProperties>');
      out = out.replace(qp, novoQp);
    }
    return out;
  }

describe('enxertarCarimbosBry — cirurgia sem re-serialização', () => {
  it('FLUXO BRy COMPLETO (FASE 1→4): enxerto preserva TODAS as verificações — incluindo a Reference URI="" da raiz', async () => {
    const { da, certPem, chavePem } = await daBase();
    const { DOMParser } = await import('@xmldom/xmldom');
    const { novoVerificador } = await import('./verificador-xades');
    const { assinarTodosEsqueletos, POLITICA_ARQUIVAMENTO } = await import('./xades-signer');
    const { validarXmlContraXsd } = await import('./xsd-validator');

    // FASE 1: as 2 assinaturas internas, SEM carimbo (modo BRy puro)
    const fase1 = await assinarTodosEsqueletos(da, {
      chavePem, certPem, quantidade: 2,
      posicoes: [{ chavePem, certPem }, { chavePem, certPem }],
    });
    // FASE 2: BRy carimba as internas (resposta re-serializada) → ENXERTO
    const fase2 = enxertarCarimbosBry(fase1, bryLike(fase1, 'RklSU1Q=', true)).xml;
    // FASE 3: raiz (AD-RA) assinada sobre o conteúdo FINAL das internas
    const fase3 = await assinarTodosEsqueletos(fase2, {
      chavePem, certPem,
      posicoes: [{ chavePem, certPem, politica: POLITICA_ARQUIVAMENTO }],
    });
    // FASE 4: BRy re-serializa TUDO de novo (e " adicionaria" carimbo até
    // nas internas) → o enxerto copia SOMENTE da raiz (as internas já têm)
    const bry4 = bryLike(fase3, 'U0VDT05E');
    const final = enxertarCarimbosBry(fase3, bry4);

    // 1) Documento final = ORIGINAL enxertado — nada da serialização BRy
    expect(final.xml).not.toBe(bry4);
    expect(final.xml).not.toContain('xades141');
    // 2) 3 carimbos no total (2 FASE 2 + 1 FASE 4 — internas não duplicadas)
    expect((final.xml.match(/<xades:EncapsulatedTimeStamp>/g) ?? []).length).toBe(3);
    expect(final.carimbosAdicionados).toBe(1);
    expect(final.xml).toContain('RklSU1Q=');
    expect(final.xml).toContain('U0VDT05E');
    // 3) TODAS as assinaturas verificáveis — incluindo URI="" da raiz
    const doc = new DOMParser().parseFromString(final.xml, 'text/xml');
    const sigs = doc.getElementsByTagNameNS('*', 'Signature');
    expect(sigs.length).toBe(3);
    for (let i = 0; i < sigs.length; i++) {
      const sig = novoVerificador(certPem, sigs[i]);
      const ok = sig.checkSignature(final.xml);
      if (!ok) for (const rf of sig.getReferences()) console.error(`BRY SIG${i} REF`, rf.uri, '→', rf.validationError);
      expect(ok).toBe(true);
    }
    // 4) XSD oficial continua válido
    const vx = await validarXmlContraXsd(final.xml, 'documentacaoAcademica');
    if (!vx.valido) console.error('ERROS XSD:', vx.erros);
    expect(vx.valido).toBe(true);

    // 5) CONTRA-TESTE (documenta a causa raiz): adotar o XML da BRy
    //    (como era até v1.4.16) quebra exatamente a raiz URI=""
    const docBry = new DOMParser().parseFromString(bry4, 'text/xml');
    const sigsBry = docBry.getElementsByTagNameNS('*', 'Signature');
    expect(novoVerificador(certPem, sigsBry[0]).checkSignature(bry4)).toBe(true); // #Dip ok
    expect(novoVerificador(certPem, sigsBry[1]).checkSignature(bry4)).toBe(true); // #Dip ok
    expect(novoVerificador(certPem, sigsBry[2]).checkSignature(bry4)).toBe(false); // raiz QUEBRA
  }, 60000);

  it('portão de integridade: DigestValue alterado pela BRy → erro EXPLÍCITO e XML intacto', () => {
    const base =
      '<r><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="S1">' +
      '<ds:SignedInfo><ds:Reference URI="#a"><ds:DigestValue>QUJD</ds:DigestValue></ds:Reference></ds:SignedInfo>' +
      '<ds:SignatureValue>WFla</ds:SignatureValue>' +
      '<ds:Object><xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"></xades:QualifyingProperties></ds:Object>' +
      '</ds:Signature></r>';
    const bryOk = base
      .replaceAll('<ds:', '<ds141:').replaceAll('</ds:', '</ds141:').replaceAll('xmlns:ds="', 'xmlns:ds141="')
      .replace('</xades:QualifyingProperties>', '</xades:QualifyingProperties>'); // sem carimbo
    const bryAlterado = bryOk.replace('QUJD', 'TEROU');
    expect(() => enxertarCarimbosBry(base, bryOk)).not.toThrow();
    expect(() => enxertarCarimbosBry(base, bryAlterado)).toThrow(/DigestValues alterados.*preservado/i);
  });

  it('portão de integridade: quantidade/Ids divergentes → erro EXPLÍCITO', () => {
    const base =
      '<r><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="S1">' +
      '<ds:SignedInfo><ds:Reference URI=""><ds:DigestValue>QUJD</ds:DigestValue></ds:Reference></ds:SignedInfo>' +
      '<ds:SignatureValue>WFla</ds:SignatureValue>' +
      '<ds:Object><xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"></xades:QualifyingProperties></ds:Object>' +
      '</ds:Signature></r>';
    const duplo = base.replace('</r>', base.slice(3) + '</r>'); // 2 assinaturas
    expect(() => enxertarCarimbosBry(base, duplo)).toThrow(/quantidade de assinaturas divergente/i);
  });

  it('não duplica: assinatura que JÁ tem carimbo não recebe outro', () => {
    const comCarimbo =
      '<r><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="S1">' +
      '<ds:SignedInfo><ds:Reference URI=""><ds:DigestValue>QUJD</ds:DigestValue></ds:Reference></ds:SignedInfo>' +
      '<ds:SignatureValue>WFla</ds:SignatureValue>' +
      '<ds:Object><xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#">' +
      '<xades:UnsignedProperties><xades:UnsignedSignatureProperties>' +
      '<xades:SignatureTimeStamp><xades:EncapsulatedTimeStamp>VE9LRU4=</xades:EncapsulatedTimeStamp></xades:SignatureTimeStamp>' +
      '</xades:UnsignedSignatureProperties></xades:UnsignedProperties>' +
      '</xades:QualifyingProperties></ds:Object>' +
      '</ds:Signature></r>';
    const bry = comCarimbo
      .replaceAll('<ds:', '<ds141:').replaceAll('</ds:', '</ds141:').replaceAll('xmlns:ds="', 'xmlns:ds141="')
      .replaceAll('<xades:', '<xades141:').replaceAll('</xades:', '</xades141:').replaceAll('xmlns:xades="', 'xmlns:xades141="');
    const r = enxertarCarimbosBry(comCarimbo, bry);
    expect(r.xml).toBe(comCarimbo);
    expect(r.carimbosAdicionados).toBe(0);
  });
});

// ============================================================
// ESCOPO POR FASE (v1.4.18) — reproduz a produção real: a BRy NÃO
// completa documentos com ds:Signature vazio (esqueleto da raiz).
// Sem `semEsqueletos`, a FASE 2 falhava silenciosamente e o carimbo
// das internas só acontecia na FASE 4, DEPOIS do digest da raiz
// URI="" → gate "digests/RSA não conferem" (audit procs 16/21).
// ============================================================
describe('escopo por fase — BRy que recusa esqueleto (cenario de produção)', () => {
  /** fetch mockado: token OK; upgrade RECUSA (erro real do audit) se o
   *  documento enviado contiver SignatureValue vazio; senão carimba
   *  TODAS as assinaturas reais (bryLike — re-serialização xades141). */
  function stubBryProducao(pedidos: string[]): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any, init?: any) => {
        if (String(url).includes('token-service')) {
          return respostaJson({ access_token: 'TOK', expires_in: 3600 });
        }
        const blob = (init?.body as FormData)?.get('signature[0]') as Blob;
        const conteudo = blob ? await blob.text() : '';
        pedidos.push(conteudo);
        const temEsqueleto = /<(?:ds:)?SignatureValue\s*\/>|<(?:ds:)?SignatureValue><\/(?:ds:)?SignatureValue>/.test(conteudo);
        if (temEsqueleto) {
          return respostaJson([
            { status: 400, message: '[excecao.signer.xml.completar]: Não foi possível completar a assinatura.' },
          ]);
        }
        return respostaJson([
          { status: 200, document: Buffer.from(bryLike(conteudo), 'utf8').toString('base64') },
        ]);
      })
    );
  }

  it(
    'FLUXO COMPLETO com escopos: FASE 2 semEsqueletos carimba as internas, FASE 4 apenasRaiz NUNCA quebra a raiz',
    async () => {
      const { da, certPem, chavePem } = await daBase();
      const { DOMParser } = await import('@xmldom/xmldom');
      const { novoVerificador } = await import('./verificador-xades');
      const { assinarTodosEsqueletos, contarEsqueletos, POLITICA_ARQUIVAMENTO } = await import('./xades-signer');
      const { validarXmlContraXsd } = await import('./xsd-validator');
      const pedidos: string[] = [];
      stubBryProducao(pedidos);

      // FASE 1 — as 2 internas (BES)
      const fase1 = await assinarTodosEsqueletos(da, {
        chavePem, certPem, quantidade: 2,
        posicoes: [{ chavePem, certPem }, { chavePem, certPem }],
      });
      // FASE 2 — semEsqueletos: a BRy (que recusa esqueleto) recebe só
      // assinaturas reais e carimba as internas ANTES da raiz existir
      const fase2 = await upgradeCarimboBry(CFG, fase1, 5000, { semEsqueletos: true });
      expect(fase2.carimbosAdicionados).toBe(2);
      expect(pedidos[0]).not.toMatch(/SignatureValue\s*\/>|SignatureValue><\/ds:SignatureValue>/);
      expect(contarEsqueletos(fase2.xml)).toBe(1); // esqueleto da raiz reintactado
      // FASE 3 — raiz AD-RA sobre o conteúdo FINAL (carimbado) das internas
      const fase3 = await assinarTodosEsqueletos(fase2.xml, {
        chavePem, certPem,
        posicoes: [{ chavePem, certPem, politica: POLITICA_ARQUIVAMENTO }],
      });
      // FASE 4 — apenasRaiz: a resposta da BRy carimba até duplicidades,
      // mas o enxerto só toca a assinatura de ARQUIVAMENTO
      const fase4 = await upgradeCarimboBry(CFG, fase3, 5000, { apenasRaiz: true });
      expect(fase4.carimbosAdicionados).toBe(1);
      expect((fase4.xml.match(/<xades:EncapsulatedTimeStamp>/g) ?? []).length).toBe(3); // 2 internas + raiz
      // TODAS verificam — raiz URI="" incluída (o gate passa)
      const doc = new DOMParser().parseFromString(fase4.xml, 'text/xml');
      const sigs = doc.getElementsByTagNameNS('*', 'Signature');
      expect(sigs.length).toBe(3);
      for (let i = 0; i < sigs.length; i++) {
        const sig = novoVerificador(certPem, sigs[i]);
        const ok = sig.checkSignature(fase4.xml);
        if (!ok) for (const rf of sig.getReferences()) console.error(`ESC SIG${i} REF`, rf.uri, '→', rf.validationError);
        expect(ok).toBe(true);
      }
      const vx = await validarXmlContraXsd(fase4.xml, 'documentacaoAcademica');
      if (!vx.valido) console.error('ERROS XSD:', vx.erros);
      expect(vx.valido).toBe(true);
    },
    60000
  );

  it(
    'REGRESSÃO (causa raiz): FASE 2 falha + FASE 4 sem escopo carimba internas pós-raiz → raiz QUEBRA; com apenasRaiz NÃO quebra',
    async () => {
      const { da, certPem, chavePem } = await daBase();
      const { DOMParser } = await import('@xmldom/xmldom');
      const { novoVerificador } = await import('./verificador-xades');
      const { assinarTodosEsqueletos, POLITICA_ARQUIVAMENTO } = await import('./xades-signer');
      const pedidos: string[] = [];
      stubBryProducao(pedidos);

      // FASE 1 — internas BES
      const fase1 = await assinarTodosEsqueletos(da, {
        chavePem, certPem, quantidade: 2,
        posicoes: [{ chavePem, certPem }, { chavePem, certPem }],
      });
      // FASE 2 — SEM o escopo novo (comportamento antigo): envia COM o
      // esqueleto → a BRy recusa com o erro real do audit
      await expect(upgradeCarimboBry(CFG, fase1, 5000)).rejects.toThrow(/Não foi possível completar a assinatura/);
      // FASE 3 — raiz assinada sobre internas AINDA sem carimbo
      const fase3 = await assinarTodosEsqueletos(fase1, {
        chavePem, certPem,
        posicoes: [{ chavePem, certPem, politica: POLITICA_ARQUIVAMENTO }],
      });
      const sigsDe = (xml: string) => {
        const d = new DOMParser().parseFromString(xml, 'text/xml');
        return Array.from(d.getElementsByTagNameNS('*', 'Signature')) as any[];
      };
      // FASE 4 SEM escopo (antigo): BRy carimba internas+raiz DEPOIS do
      // digest da raiz → o gate rejeitaria exatamente com URI=""
      const antigo = await upgradeCarimboBry(CFG, fase3, 5000);
      expect((antigo.xml.match(/<xades:EncapsulatedTimeStamp>/g) ?? []).length).toBe(3);
      const raizAntiga = sigsDe(antigo.xml)[2];
      expect(novoVerificador(certPem, raizAntiga).checkSignature(antigo.xml)).toBe(false);
      // FASE 4 COM apenasRaiz (novo): só a raiz é tocada — internas
      // permanecem BES (degradação honesta com aviso) e TUDO verifica
      const novo = await upgradeCarimboBry(CFG, fase3, 5000, { apenasRaiz: true });
      expect((novo.xml.match(/<xades:EncapsulatedTimeStamp>/g) ?? []).length).toBe(1); // só a raiz
      const sigsNovo = sigsDe(novo.xml);
      for (let i = 0; i < sigsNovo.length; i++) {
        const sig = novoVerificador(certPem, sigsNovo[i]);
        const ok = sig.checkSignature(novo.xml);
        if (!ok) for (const rf of sig.getReferences()) console.error(`REG SIG${i} REF`, rf.uri, '→', rf.validationError);
        expect(ok).toBe(true);
      }
    },
    60000
  );
});

// ============================================================
// v1.4.19 — finalizarCarimbosBry: retries + invariante "BRy em todas"
// (falha transiente recupera; falha de vez ABORTA com tentativas na
// mensagem; resposta sem carimbar também é falha).
// ============================================================
describe('finalizarCarimbosBry — política tudo-ou-nada', () => {
  const XML_1SIG =
    '<raiz xmlns="urn:teste">' +
    '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="xmldsig-t1">' +
    '<ds:SignedInfo>' +
    '<ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>' +
    '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>' +
    '<ds:Reference URI="">' +
    '<ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/></ds:Transforms>' +
    '<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>' +
    '<ds:DigestValue>QUJD</ds:DigestValue>' +
    '</ds:Reference>' +
    '</ds:SignedInfo>' +
    '<ds:SignatureValue>UVdG</ds:SignatureValue>' +
    '<ds:Object><xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="#xmldsig-t1">' +
    '<xades:SignedProperties Id="xmldsig-t1-signed-properties"/>' +
    '</xades:QualifyingProperties></ds:Object>' +
    '</ds:Signature></raiz>';

  /** fetch mockado: token OK; upgrade delega em `responderUpgrade(i)`
   *  (i = nº da tentativa). Conta as chamadas de upgrade em `chamadas`. */
  function stubUpgrade(chamadas: string[], responderUpgrade: (tentativa: number, conteudo: string) => Promise<Response>): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any, init?: any) => {
        if (String(url).includes('token-service')) {
          return respostaJson({ access_token: 'TOK', expires_in: 3600 });
        }
        const blob = (init?.body as FormData)?.get('signature[0]') as Blob;
        const conteudo = blob ? await blob.text() : '';
        chamadas.push(conteudo);
        return responderUpgrade(chamadas.length, conteudo);
      })
    );
  }

  it('falha transiente 2× e RECUPERA na 3ª tentativa (mesma política do handler)', async () => {
    const chamadas: string[] = [];
    stubUpgrade(chamadas, async (tentativa, conteudo) => {
      if (tentativa < 3) throw new Error('Falha de rede com o BRy HUB: ECONNRESET');
      return respostaJson([{ status: 200, document: Buffer.from(bryLike(conteudo), 'utf8').toString('base64') }]);
    });
    const r = await finalizarCarimbosBry(CFG, XML_1SIG, 5000, {}, { tentativas: 3, intervaloMs: 5 });
    expect(chamadas).toHaveLength(3);
    expect(r.carimbosAdicionados).toBe(1);
    expect(r.xml).toContain('<xades:EncapsulatedTimeStamp>');
  });

  it('sucesso na 1ª tentativa não refaz chamadas', async () => {
    const chamadas: string[] = [];
    stubUpgrade(chamadas, async (_t, conteudo) =>
      respostaJson([{ status: 200, document: Buffer.from(bryLike(conteudo), 'utf8').toString('base64') }])
    );
    const r = await finalizarCarimbosBry(CFG, XML_1SIG, 5000, {}, { tentativas: 3, intervaloMs: 5 });
    expect(chamadas).toHaveLength(1);
    expect(r.carimbosAdicionados).toBe(1);
  });

  it('falha de vez ABORTA com o nº de tentativas na mensagem', async () => {
    const chamadas: string[] = [];
    stubUpgrade(chamadas, async () => {
      throw new Error('Falha de rede com o BRy HUB: ECONNRESET');
    });
    await expect(
      finalizarCarimbosBry(CFG, XML_1SIG, 5000, {}, { tentativas: 3, intervaloMs: 5 })
    ).rejects.toThrow(/BRy HUB falhou em 3 tentativa\(s\).*ECONNRESET/);
    expect(chamadas).toHaveLength(3);
  });

  it('responde sucesso SEM carimbar (0 stamps) → invariante falha e aborta', async () => {
    const chamadas: string[] = [];
    // BRy "ok" mas devolve o documento IGUAL (nenhum carimbo adicionado)
    stubUpgrade(chamadas, async (_t, conteudo) =>
      respostaJson([{ status: 200, document: Buffer.from(conteudo, 'utf8').toString('base64') }])
    );
    await expect(
      finalizarCarimbosBry(CFG, XML_1SIG, 5000, {}, { tentativas: 2, intervaloMs: 5 })
    ).rejects.toThrow(/falhou em 2 tentativa\(s\).*sem carimbar.*1 assinatura\(s\)/s);
    expect(chamadas).toHaveLength(2);
  });
});
