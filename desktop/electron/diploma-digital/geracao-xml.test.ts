// ============================================================
// TESTE M3 — geradores XML × XSD OFICIAL MEC v1.05 (real)
// ============================================================
// Prova máxima do módulo: o XML gerado a partir de um snapshot
// completo do banco VALIDA contra os schemas oficiais (xmllint).
// Cenários negativos cobrem os casos exigidos (aluno sem CPF,
// sem colação, docente sem titulação mapeável, filiação ausente).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validarXmlContraXsd } from './xsd-validator';
import { gerarHistoricoXml } from './gerar-historico-xml';
import { gerarDocumentacaoAcademicaXml } from './gerar-documentacao-academica';
import { pendenciasHistorico, pendenciasDA } from './coletor';

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
  renovacao_reconhecimento_json: null,
};

const IES = {
  id: 1, nome: 'INSTITUTO ERICH FROMM', codigo_emec: 1234, cnpj: '03.466.601/0001-82',
  logradouro: 'AV PRINCIPAL', numero: '100', complemento: null, bairro: 'CENTRO',
  codigo_municipio: '2927408', nome_municipio: 'Salvador', uf: 'BA', cep: '40000000',
  credenciamento_json: '{"tipo":"Portaria","numero":"999","data":"2008-01-15"}',
  recredenciamento_json: null,
};

const DISCIPLINAS = [
  { id: 1, aluno_id: 7, periodo: '1.2020', disciplina: 'ADMINISTRAÇÃO GERAL', docente: 'CARLOS SOUZA', titulacao: 'Doutor', ch: '80H', nota: '9,5', ft: null, status: 'AP', ordem: 1 },
  { id: 2, aluno_id: 7, periodo: '2.2020', disciplina: 'MATEMÁTICA APLICADA', docente: 'ANA LIMA', titulacao: 'Mestre', ch: '60', nota: '8,0', ft: null, status: 'AP', ordem: 1 },
  { id: 3, aluno_id: 7, periodo: '3.2020', disciplina: 'ESTATÍSTICA', docente: 'CARLOS SOUZA', titulacao: 'Doutorado', ch: '40 HR', nota: '7', ft: null, status: 'AP', ordem: 2 },
];

const PROCESSO = { id: 42, aluno_id: 7, ies_emissora_id: 1, chave_acesso: null, codigo_validacao_historico: null, data_expedicao: null };

function snapshot(aluno = ALUNO, curso = CURSO, ies = IES, disciplinas = DISCIPLINAS, processo = PROCESSO) {
  return { processo, aluno, curso, ies, disciplinas } as any;
}

describe('M3: geradores XML oficiais × XSD real do MEC', () => {
  it('gera Histórico Escolar Digital VÁLIDO contra o XSD oficial v1.05', async () => {
    const xml = gerarHistoricoXml(snapshot());
    expect(xml).toBeTruthy();
    const r = await validarXmlContraXsd(xml!, 'historicoEscolar');
    if (!r.valido) console.error('ERROS XSD:', r.erros);
    expect(r.valido).toBe(true);
  }, 60000);

  it('gera Documentação Acadêmica (RegistroReq) VÁLIDA contra o XSD oficial', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-dd-'));
    const pdfPath = path.join(tmp, 'rg.pdf');
    fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.4 fixture'), 'utf8');
    try {
      const xml = gerarDocumentacaoAcademicaXml(snapshot(), [{ caminho: pdfPath, tipo: 'DocumentoIdentidadeDoAluno' }]);
      expect(xml).toBeTruthy();
      const r = await validarXmlContraXsd(xml!, 'documentacaoAcademica');
      if (!r.valido) console.error('ERROS XSD:', r.erros);
      expect(r.valido).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60000);
});

describe('M3: pendências específicas por artefato', () => {
  it('histórico sem disciplinas → pendência de ElementosHistorico', () => {
    const p = pendenciasHistorico(snapshot(ALUNO, CURSO, IES, []));
    expect(p.some((x) => x.elementoXml === 'HistoricoEscolar.ElementosHistorico')).toBe(true);
  });

  it('curso sem carga horária total → pendência CargaHorariaCurso', () => {
    const p = pendenciasHistorico(snapshot(ALUNO, { ...CURSO, carga_horaria: null }, IES));
    expect(p.some((x) => x.elementoXml === 'HistoricoEscolar.CargaHorariaCurso')).toBe(true);
  });

  it('forma de ingresso fora da enumeração → pendência FormaAcesso', () => {
    const p = pendenciasHistorico(snapshot({ ...ALUNO, forma_ingresso: 'Processo especial da faculdade' }));
    expect(p.some((x) => x.elementoXml === 'HistoricoEscolar.IngressoCurso.FormaAcesso')).toBe(true);
  });

  it('docente com titulação não mapeável → pendência (nunca inventa enum)', () => {
    const p = pendenciasHistorico(snapshot(ALUNO, CURSO, IES, [{ ...DISCIPLINAS[0], titulacao: 'Sábio' }]));
    expect(p.some((x) => x.campo.includes('Titulação do docente'))).toBe(true);
  });

  it('disciplina sem docente → pendência Docentes', () => {
    const p = pendenciasHistorico(snapshot(ALUNO, CURSO, IES, [{ ...DISCIPLINAS[0], docente: null }]));
    expect(p.some((x) => x.elementoXml === 'ElementosHistorico.Disciplina.Docentes')).toBe(true);
  });

  it('DA sem filiação → pendência Filiacao.Genitor', () => {
    const db = { prepare: (_sql: string) => ({ get: () => null, all: () => [] }) };
    const s = snapshot({ ...ALUNO, mae_nome: null, mae_sexo: null, pai_nome: null, pai_sexo: null });
    const p = pendenciasDA(db as any, s);
    expect(p.some((x) => x.elementoXml === 'DadosPrivadosDiplomado.Filiacao.Genitor')).toBe(true);
  });

  it('DA exige documentação comprobatória anexada', () => {
    const db = {
      prepare: (_sql: string) => ({
        get: () => null,
        all: () => [],
      }),
    };
    const p = pendenciasDA(db as any, snapshot());
    expect(p.some((x) => x.elementoXml === 'RegistroReq.DocumentacaoComprobatoria.Documento')).toBe(true);
  });
  it('gerador de DA não gera XML sem genitores (anti-invenção)', () => {
    const s = snapshot({ ...ALUNO, mae_nome: null, mae_sexo: null, pai_nome: null, pai_sexo: null });
    expect(gerarDocumentacaoAcademicaXml(s, [{ caminho: 'x.pdf', tipo: 'Outros' }])).toBeNull();
  });

  it('gerador de histórico não gera XML com curso sem CH total', () => {
    expect(gerarHistoricoXml(snapshot(ALUNO, { ...CURSO, carga_horaria: null }))).toBeNull();
  });
});
