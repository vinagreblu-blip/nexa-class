// ============================================================
// PENDÊNCIAS DO DIPLOMA — requisitos para "apto para diploma"
// ============================================================
// Módulo PURO (adapter db injetável, mesmo contrato do
// sync-core) — testável em vitest sem Electron.
//
// Verifica, NA ORDEM DOS ELEMENTOS DO XSD oficial
// (leiauteDiplomaDigital_v1.05.xsd), os dados obrigatórios para
// gerar o Diploma Digital. Campo ausente = PENDÊNCIA (nunca é
// inventado nem preenchido com valor fake).
//

export interface PendenciaDiploma {
  /** Campo legível para a UI (ex.: "CPF do aluno"). */
  campo: string;
  /** Caminho do elemento no XML oficial (ex.: "Diplomado.CPF"). */
  elementoXml: string;
  /** Tabela/coluna de onde o dado deve vir. */
  origem: string;
  motivo: string;
  comoObter: string;
}

interface AdapterDb {
  prepare(sql: string): { all?: (...a: any[]) => any[]; get: (...a: any[]) => any };
}

import { normalizarCpf, normalizarCnpj, normalizarCep, normalizarData, normalizarSexo, normalizarRg, normalizarUf } from './normalizadores';

/** Ato regulatório válido = JSON parseável com tipo+numero+data AAAA-MM-DD
 *  (exigência do XSD: o ato completo ou nada — gate de mera presença do
 *  TEXT não-nulo deixava passar JSON incompleto/inválido). */
function atoRegulatorioOk(json: unknown): boolean {
  if (!json) return false;
  try {
    const ato = JSON.parse(String(json));
    return !!ato?.tipo && !!ato?.numero && !!normalizarData(ato.data);
  } catch {
    return false;
  }
}

export function verificarPendenciasDiploma(db: AdapterDb, alunoId: number): PendenciaDiploma[] {
  const pend: PendenciaDiploma[] = [];
  const aluno = db.prepare('SELECT * FROM alunos WHERE id = ?').get(alunoId) as any;
  if (!aluno) {
    return [
      {
        campo: 'Aluno',
        elementoXml: 'Diplomado',
        origem: 'alunos',
        motivo: 'Aluno não encontrado',
        comoObter: 'Cadastre o aluno antes de abrir o processo do diploma.',
      },
    ];
  }

  // --- Diplomado (TDadosDiplomado) ---
  if (!normalizarCpf(aluno.cpf)) {
    pend.push({
      campo: 'CPF do aluno',
      elementoXml: 'Diplomado.CPF',
      origem: 'alunos.cpf',
      motivo: !aluno.cpf ? 'não cadastrado' : 'formato inválido (esperado 11 dígitos)',
      comoObter: 'Complemente o cadastro do aluno com o CPF (11 dígitos).',
    });
  }
  if (!normalizarSexo(aluno.sexo)) {
    pend.push({
      campo: 'Sexo do aluno',
      elementoXml: 'Diplomado.Sexo',
      origem: 'alunos.sexo',
      motivo: !aluno.sexo ? 'não cadastrado' : 'valor fora de M/F',
      comoObter: 'Informe M ou F no cadastro do aluno.',
    });
  }
  if (!aluno.nacionalidade) {
    pend.push({
      campo: 'Nacionalidade',
      elementoXml: 'Diplomado.Nacionalidade',
      origem: 'alunos.nacionalidade',
      motivo: 'não cadastrada',
      comoObter: 'Informe a nacionalidade (ex.: Brasileiro(a)).',
    });
  }
  const natEstrangeira = !!aluno.naturalidade_estrangeira;
  if (!natEstrangeira) {
    const codOk = typeof aluno.naturalidade_codigo_ibge === 'string' && /^\d{7}$/.test(aluno.naturalidade_codigo_ibge);
    const ufOk = !!normalizarUf(aluno.naturalidade_uf);
    if (!codOk || !ufOk) {
      pend.push({
        campo: 'Naturalidade (município IBGE)',
        elementoXml: 'Diplomado.Naturalidade.CodigoMunicipio/UF',
        origem: 'alunos.naturalidade_codigo_ibge / naturalidade_uf',
        motivo: !aluno.naturalidade
          ? 'naturalidade não cadastrada'
          : 'falta código IBGE (7 dígitos) e/ou UF da naturalidade',
        comoObter: 'Informe o código IBGE do município e a UF (consulta: codigos.ibge.gov.br). Para naturalidade estrangeira, marque a opção correspondente.',
      });
    }
  }
  const rgOk = normalizarRg(aluno.rg);
  const rgUfOk = !!normalizarUf(aluno.rg_uf);
  if (!rgOk || !rgUfOk) {
    pend.push({
      campo: 'RG do aluno (número + UF)',
      elementoXml: 'Diplomado.RG',
      origem: 'alunos.rg / alunos.rg_uf',
      motivo: !aluno.rg ? 'RG não cadastrado' : !rgOk ? 'número de RG inválido (4–15 caracteres alfanuméricos)' : 'UF de expedição do RG não cadastrada',
      comoObter: 'Informe o número do RG e a UF de expedição (o XSD exige a UF do RG).',
    });
  }
  if (!normalizarData(aluno.data_nascimento)) {
    pend.push({
      campo: 'Data de nascimento',
      elementoXml: 'Diplomado.DataNascimento',
      origem: 'alunos.data_nascimento',
      motivo: !aluno.data_nascimento ? 'não cadastrada' : 'formato não reconhecido (use DD/MM/AAAA ou AAAA-MM-DD)',
      comoObter: 'Informe a data de nascimento do aluno.',
    });
  }

  // --- Conclusão/Colação (TDadosDiploma.DataConclusao e LivroRegistro.DataColacaoGrau) ---
  const concluido = !!aluno.ano_conclusao && aluno.ano_conclusao !== 'Cursando';
  if (!concluido) {
    pend.push({
      campo: 'Conclusão do curso',
      elementoXml: 'DadosDiploma.DataConclusao',
      origem: 'alunos.ano_conclusao',
      motivo: 'aluno ainda cursando (ou sem ano de conclusão)',
      comoObter: 'Registre a conclusão do aluno para habilitar o diploma.',
    });
  }
  const colacao = normalizarData(aluno.data_colacao);
  if (!colacao) {
    pend.push({
      campo: 'Data de colação de grau',
      elementoXml: 'DadosRegistro.LivroRegistro.DataColacaoGrau',
      origem: 'alunos.data_colacao / atas_colacao.data',
      motivo: !aluno.data_colacao ? 'não cadastrada' : 'formato não reconhecido',
      comoObter: 'Informe a data de colação de grau (ou emita a Ata de Colação).',
    });
  }

  // --- DadosCurso (TDadosCurso): precisa de curso cadastrado e completo ---
  const curso = aluno.curso
    ? (db
        .prepare('SELECT c.*, i.nome AS ies_nome, i.codigo_emec AS ies_codigo_emec, i.cnpj AS ies_cnpj, i.logradouro AS ies_logradouro, i.bairro AS ies_bairro, i.codigo_municipio AS ies_codigo_municipio, i.nome_municipio AS ies_nome_municipio, i.uf AS ies_uf, i.cep AS ies_cep, i.credenciamento_json AS ies_credenciamento FROM cursos c JOIN ies i ON i.id = c.ies_id WHERE LOWER(c.nome) = LOWER(?) AND c.ativo = 1 ORDER BY c.id LIMIT 1')
        .get(aluno.curso) as any)
    : undefined;
  if (!aluno.curso) {
    pend.push({
      campo: 'Curso do aluno',
      elementoXml: 'DadosCurso.NomeCurso',
      origem: 'alunos.curso',
      motivo: 'aluno sem curso informado',
      comoObter: 'Vincule o aluno a um curso de graduação.',
    });
  } else if (!curso) {
    pend.push({
      campo: `Curso "${aluno.curso}" no cadastro institucional`,
      elementoXml: 'DadosCurso.*',
      origem: 'cursos (cadastro institucional)',
      motivo: 'curso de graduação não cadastrado (dados oficiais ausentes)',
      comoObter: 'Cadastre o curso em Diplomas Digitais → Cadastro Institucional com código e-MEC, modalidade, título, grau e atos regulatórios.',
    });
  } else {
    if (!curso.codigo_emec) {
      pend.push({
        campo: `Código e-MEC do curso ${curso.nome}`,
        elementoXml: 'DadosCurso.CodigoCursoEMEC',
        origem: 'cursos.codigo_emec',
        motivo: 'não cadastrado',
        comoObter: 'Informe o código e-MEC do curso (e-MEC → consulta de cursos).',
      });
    }
    if (!curso.modalidade) {
      pend.push({
        campo: 'Modalidade do curso',
        elementoXml: 'DadosCurso.Modalidade',
        origem: 'cursos.modalidade',
        motivo: 'não cadastrada (Presencial ou EAD)',
        comoObter: 'Informe a modalidade no cadastro do curso.',
      });
    }
    if (!curso.titulo_conferido && !curso.outro_titulo) {
      pend.push({
        campo: 'Título conferido',
        elementoXml: 'DadosCurso.TituloConferido',
        origem: 'cursos.titulo_conferido',
        motivo: 'não cadastrado (Licenciado/Tecnólogo/Bacharel/Médico ou outro)',
        comoObter: 'Informe o título conferido pelo curso.',
      });
    }
    if (!curso.grau_conferido) {
      pend.push({
        campo: 'Grau conferido',
        elementoXml: 'DadosCurso.GrauConferido',
        origem: 'cursos.grau_conferido',
        motivo: 'não cadastrado (Bacharelado/Licenciatura/Tecnólogo/Curso sequencial)',
        comoObter: 'Informe o grau conferido pelo curso.',
      });
    }
    if (!atoRegulatorioOk(curso.autorizacao_json)) {
      pend.push({
        campo: 'Ato de autorização do curso',
        elementoXml: 'DadosCurso.Autorizacao',
        origem: 'cursos.autorizacao_json',
        motivo: !curso.autorizacao_json ? 'não cadastrado' : 'incompleto/inválido (exige tipo, número e data AAAA-MM-DD)',
        comoObter: 'Informe o ato regulatório de autorização (tipo, número e data — DOU quando houver).',
      });
    }
    if (!atoRegulatorioOk(curso.reconhecimento_json)) {
      pend.push({
        campo: 'Ato de reconhecimento do curso',
        elementoXml: 'DadosCurso.Reconhecimento',
        origem: 'cursos.reconhecimento_json',
        motivo: !curso.reconhecimento_json ? 'não cadastrado' : 'incompleto/inválido (exige tipo, número e data AAAA-MM-DD)',
        comoObter: 'Informe o ato regulatório de reconhecimento (tipo, número e data).',
      });
    }
  }

  // --- IesEmissora (TDadosIesEmissora) ---
  if (!curso || !curso.ies_codigo_emec) {
    pend.push({
      campo: 'Código e-MEC da IES emissora',
      elementoXml: 'IesEmissora.CodigoMEC',
      origem: 'ies.codigo_emec',
      motivo: !curso ? 'IES não identificada (curso não cadastrado)' : 'não cadastrado',
      comoObter: 'Informe o código e-MEC da IES no Cadastro Institucional.',
    });
  }
  if (!curso || !normalizarCnpj(curso.ies_cnpj)) {
    pend.push({
      campo: 'CNPJ da IES emissora',
      elementoXml: 'IesEmissora.CNPJ',
      origem: 'ies.cnpj',
      motivo: !curso ? 'IES não identificada' : !curso.ies_cnpj ? 'não cadastrado' : 'formato inválido (esperado 14 dígitos)',
      comoObter: 'Informe o CNPJ (14 dígitos) da IES.',
    });
  }
  if (!atoRegulatorioOk(curso?.ies_credenciamento)) {
    pend.push({
      campo: 'Credenciamento da IES',
      elementoXml: 'IesEmissora.Credenciamento',
      origem: 'ies.credenciamento_json',
      motivo: !curso ? 'IES não identificada' : !curso?.ies_credenciamento ? 'ato de credenciamento não cadastrado' : 'ato incompleto/inválido (exige tipo, número e data AAAA-MM-DD)',
      comoObter: 'Informe o ato de credenciamento da IES (tipo, número e data).',
    });
  }
  const iesEndOk =
    !!curso && !!curso.ies_logradouro && !!curso.ies_bairro && !!curso.ies_codigo_municipio &&
    !!curso.ies_nome_municipio && !!curso.ies_uf && !!normalizarCep(curso.ies_cep);
  if (!iesEndOk) {
    pend.push({
      campo: 'Endereço da IES emissora',
      elementoXml: 'IesEmissora.Endereco',
      origem: 'ies.logradouro/bairro/codigo_municipio/nome_municipio/uf/cep',
      motivo: !curso ? 'IES não identificada' : 'endereço incompleto (logradouro, bairro, município IBGE, nome do município, UF e CEP)',
      comoObter: 'Complete o endereço da IES no Cadastro Institucional.',
    });
  }

  return pend;
}
