// ============================================================
// REGRESSÃO (v1.4.12 → Hélio Rocha): "libxml2: out of memory"
// ============================================================
// A DA embute os PDFs do aluno em base64; com documentos escaneados
// grandes, o heap WASM default do xmllint-wasm (512 páginas = 32 MiB)
// estourava ao gravar o arquivo no FS em memória/parsear o DOM —
// validateXML rejeitava com "libxml2: out of memory" e a geração do
// diploma falhava ("Falha ao executar a validação XSD"). O validador
// agora roda com teto de 2 GiB (initialMemoryPages/maxMemoryPages).
// Este teste reproduz o cenário: DA com documento de ~24 MB (base64
// ~33 MB) NÃO pode lançar OOM — deve retornar um resultado de
// validação, como qualquer documento.
// ============================================================
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { validarXmlContraXsd } from './xsd-validator';
import { gerarDocumentacaoAcademicaXml } from './gerar-documentacao-academica';

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
];

const PROCESSO = { id: 42, aluno_id: 7, ies_emissora_id: 1, chave_acesso: null, codigo_validacao_historico: null, data_expedicao: null };

describe('regressão OOM: DA com documento grande não estoura a memória do validador', () => {
  it('validação de DA com PDF de ~24 MB (base64 ~33 MB) retorna resultado — sem "out of memory"', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-dd-oom-'));
    const docGrande = path.join(tmp, 'rg-digitalizado.pdf');
    // Bytes aleatórios: incompressíveis, tamanho real de um RG escaneado pesado.
    fs.writeFileSync(docGrande, randomBytes(24 * 1024 * 1024));
    try {
      const snapshot = { processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any;
      const xml = gerarDocumentacaoAcademicaXml(snapshot, [{ caminho: docGrande, tipo: 'DocumentoIdentidadeDoAluno' }]);
      expect(xml).toBeTruthy();
      // Sem o fix, validateXML rejeita com "libxml2: out of memory" (heap
      // default de 32 MiB < arquivo base64 + DOM). Com o fix, retorna
      // ResultadoValidacao — válido ou com erros normais de schema, nunca OOM.
      const r = await validarXmlContraXsd(xml!, 'documentacaoAcademica');
      expect(r).toBeTruthy();
      expect(typeof r.valido).toBe('boolean');
      expect((r.erros ?? []).join('\n').toLowerCase()).not.toContain('out of memory');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 180000);
});
