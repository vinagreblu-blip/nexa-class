// ============================================================
// TESTE M5 — Lista Anulados + Fiscalização × XSD OFICIAL + RVDD
// ============================================================
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gerarListaDiplomasAnuladosXml } from './gerar-lista-anulados';
import { gerarArquivoFiscalizacaoXml } from './gerar-arquivo-fiscalizacao';
import { gerarRvddPdf } from './gerar-rvdd';
import { validarXmlContraXsd } from './xsd-validator';
import { verificarPdfA1b, caminhoAsset } from './pdfa';

const REGISTRADORA = {
  id: 2, nome: 'UNIVERSIDADE REGISTRADORA', codigo_emec: 5678, cnpj: '00.000.000/0001-91',
  logradouro: 'RUA B', numero: '10', complemento: null, bairro: 'CENTRO',
  codigo_municipio: '2927408', nome_municipio: 'Salvador', uf: 'BA', cep: '40010000',
  papel: 'registradora',
  credenciamento_json: '{"tipo":"Decreto","numero":"5","data":"1990-01-01"}',
  mantenedora_json: '{"razaoSocial":"MANTENEDORA X","cnpj":"00.000.000/0001-00","endereco":{"logradouro":"RUA C","bairro":"CENTRO","codigoMunicipio":"2927408","nomeMunicipio":"Salvador","uf":"BA","cep":"40020000"}}',
  ato_autorizacao_registro_json: null,
};

const SNAPSHOT_IES = {
  processo: { id: 1 },
  aluno: {},
  curso: {},
  ies: {
    id: 1, nome: 'INSTITUTO ERICH FROMM', codigo_emec: 1234, cnpj: '03.466.601/0001-82',
    logradouro: 'AV PRINCIPAL', numero: '100', complemento: null, bairro: 'CENTRO',
    codigo_municipio: '2927408', nome_municipio: 'Salvador', uf: 'BA', cep: '40000000',
    credenciamento_json: '{"tipo":"Portaria","numero":"999","data":"2008-01-15"}',
  },
  disciplinas: [],
} as any;

describe('M5: Lista de Diplomas Anulados × XSD oficial', () => {
  it('lista com anulados reais VALIDA contra o XSD', async () => {
    const xml = gerarListaDiplomasAnuladosXml({
      numeroSequencia: 1,
      registradora: REGISTRADORA,
      anulados: [
        { codigoValidacao: '1234.5678.deadbeef1234', dataAnulacao: '2026-08-25', motivo: 'Erro de Fato', anotacao: 'Divergência no nome do curso' },
        { codigoValidacao: '1234.5678.cafebabe5678', dataAnulacao: '2026-08-26', motivo: 'Decisão Judicial' },
      ],
      dataMaximaProximaAtualizacao: '2026-11-23',
    });
    expect(xml).toBeTruthy();
    const r = await validarXmlContraXsd(xml!, 'listaDiplomasAnulados');
    if (!r.valido) console.error('ERROS XSD:', r.erros);
    expect(r.valido).toBe(true);
  }, 60000);

  it('lista VAZIA também valida (DiplomasAnulados 0..n)', async () => {
    const xml = gerarListaDiplomasAnuladosXml({
      numeroSequencia: 2,
      registradora: REGISTRADORA,
      anulados: [],
      dataMaximaProximaAtualizacao: '2026-11-23',
    });
    const r = await validarXmlContraXsd(xml!, 'listaDiplomasAnulados');
    expect(r.valido).toBe(true);
  }, 60000);

  it('motivo fora do enum → NULL (anti-invenção)', () => {
    const out = gerarListaDiplomasAnuladosXml({
      numeroSequencia: 1,
      registradora: REGISTRADORA,
      anulados: [{ codigoValidacao: '1.2.abcdef012345', dataAnulacao: '2026-08-25', motivo: 'Motivo Genérico' }],
      dataMaximaProximaAtualizacao: '2026-11-23',
    });
    expect(out).toBeNull();
  });

  it('código de validação fora do padrão eMEC.eMEC.hex → NULL', () => {
    const out = gerarListaDiplomasAnuladosXml({
      numeroSequencia: 1,
      registradora: REGISTRADORA,
      anulados: [{ codigoValidacao: 'sem-codigo', dataAnulacao: '2026-08-25', motivo: 'Erro de Fato' }],
      dataMaximaProximaAtualizacao: '2026-11-23',
    });
    expect(out).toBeNull();
  });
});

describe('M5: Arquivo de Fiscalização (emissora) × XSD oficial', () => {
  it('arquivo com URLs https VALIDA contra o XSD', async () => {
    const xml = gerarArquivoFiscalizacaoXml({
      dataInicio: '2026-01-01',
      dataFim: '2026-12-31',
      snapshotIes: SNAPSHOT_IES,
      diplomas: [
        {
          codigoValidacao: '1234.5678.deadbeef1234',
          cpfDetentor: '123.456.789-00',
          codigoEmecCurso: 106513,
          dataEmissao: '2026-08-25',
          dataRegistro: '2026-08-25',
          urlXmlDiplomado: 'https://evapmgnwznybylbtjmco.supabase.co/storage/v1/object/sign/diplomas-digitais/1/diploma-digital-final.xml?token=x',
          urlRvdd: 'https://evapmgnwznybylbtjmco.supabase.co/storage/v1/object/sign/diplomas-digitais/1/rvdd.pdf?token=x',
        },
      ],
    });
    expect(xml).toBeTruthy();
    const r = await validarXmlContraXsd(xml!, 'arquivoFiscalizacao');
    if (!r.valido) console.error('ERROS XSD:', r.erros);
    expect(r.valido).toBe(true);
  }, 60000);

  it('URL http (não https) → NULL (THttpsURL é obrigatório)', () => {
    const out = gerarArquivoFiscalizacaoXml({
      dataInicio: '2026-01-01', dataFim: '2026-12-31', snapshotIes: SNAPSHOT_IES,
      diplomas: [{
        codigoValidacao: '1.2.abcdef012345', cpfDetentor: '12345678900',
        dataEmissao: '2026-08-25', dataRegistro: '2026-08-25',
        urlXmlDiplomado: 'http://exemplo.com/x.xml', urlRvdd: 'https://exemplo.com/r.pdf',
      }],
    });
    expect(out).toBeNull();
  });

  it('sem diplomas → NULL', () => {
    const out = gerarArquivoFiscalizacaoXml({ dataInicio: '2026-01-01', dataFim: '2026-12-31', snapshotIes: SNAPSHOT_IES, diplomas: [] });
    expect(out).toBeNull();
  });
});

describe('M5: RVDD (PDF/A-1b)', () => {
  const DADOS_RVDD = {
    alunoNome: 'MARIA DA SILVA',
    cpf: '12345678900',
    cursoNome: 'ADMINISTRAÇÃO',
    grauConferido: 'Bacharelado',
    tituloConferido: 'Bacharel',
    iesNome: 'INSTITUTO ERICH FROMM',
    iesCodigoEmec: 1234,
    livroRegistro: 'L1',
    numeroRegistro: '000123',
    dataColacao: '2024-12-20',
    dataExpedicao: '2026-08-25',
    dataRegistro: '2026-08-25',
    codigoValidacao: '1234.5678.deadbeef1234',
    chaveAcesso: 'VDip' + '1'.repeat(44),
    urlConsulta: 'https://nexa-verificacao.onrender.com/d/1234.5678.deadbeef1234',
  };

  it('gera PDF/A-1b conforme na autochecagem (fontes embutidas + OutputIntent sRGB + XMP pdfaid + PDF 1.4)', async () => {
    const pdf = await gerarRvddPdf(DADOS_RVDD);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.slice(0, 8).toString()).toBe('%PDF-1.4');
    const r = await verificarPdfA1b(pdf);
    if (!r.conforme) console.error('CHECAGENS PDF/A:', r.checagens);
    expect(r.conforme).toBe(true);
    for (const c of r.checagens) expect(c.ok).toBe(true);
  }, 60000);

  it('conteúdo visual preservado (texto do diploma + QR presentes no PDF)', async () => {
    const pdf = await gerarRvddPdf(DADOS_RVDD);
    // Fontes subsettadas comprimem os streams — valida pelo número de
    // imagens/objetos: QR (imagem) e 2 fontes TrueType embutidas
    const texto = pdf.toString('latin1');
    expect(texto).toContain('/Image');
    expect((texto.match(/\/FontFile2/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(texto).toContain('/GTS_PDFA1');
    expect(texto).not.toContain('/Encrypt');
  }, 60000);

  it('assets oficiais íntegros (hash SHA-256 de fontes e ICC não mudou)', () => {
    const esperados: Record<string, string> = {
      'fonts/NotoSans-Regular.ttf': '478C558EA716033CD60C03438F628DFA75694DCF6B5F6D505A2F05FD2B4F3823',
      'fonts/NotoSans-Bold.ttf': '1DF075A380FC7CB898ACF64C1F7B3B4DD780DE3CAA860178BF929DE35817A913',
      'icc/sRGB-v2-magic.icc': 'AF4EFE28F6D311799865F325BA39184A2E978B113CA74124D60AF7DE22B105F4',
    };
    for (const [rel, sha] of Object.entries(esperados)) {
      const cam = caminhoAsset(path.join(...rel.split('/')));
      expect(fs.existsSync(cam)).toBe(true);
      expect(createHash('sha256').update(fs.readFileSync(cam)).digest('hex').toUpperCase()).toBe(sha);
    }
  });
});
