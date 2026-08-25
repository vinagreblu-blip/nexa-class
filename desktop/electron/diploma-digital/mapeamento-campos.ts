// ============================================================
// MAPEAMENTO DE CAMPOS — banco local → elementos do XSD oficial
// ============================================================
// ÚNICA FONTE DE VERDADE do M3. Cada linha documenta:
// CAMPO OFICIAL → TABELA → COLUNA → TRANSFORMAÇÃO → ELEMENTO XML.
// Nenhum gerador pode inventar campo fora deste mapa.
//
// Legenda das transformações:
//   direta      = valor usado como está
//   normalizada = via normalizadores.ts (formato exigido pelo XSD)
//   derivada    = computada de dados existentes (determinística,
//                 documentada; nunca inventa dado novo de fonte externa)
//   enum        = valor livre mapeado para enumeração do XSD
//   pendência   = se ausente, gera pendência (NUNCA é preenchido)
//

export interface MapeamentoCampo {
  campoOficial: string;
  tabela: string;
  coluna: string;
  transformacao: string;
  elementoXml: string;
}

export const MAPA_DIPLOMADO: MapeamentoCampo[] = [
  { campoOficial: 'ID do diplomado (matrícula)', tabela: 'alunos', coluna: 'matricula', transformacao: 'direta', elementoXml: 'Diplomado.ID' },
  { campoOficial: 'Nome', tabela: 'alunos', coluna: 'nome', transformacao: 'direta', elementoXml: 'Diplomado.Nome' },
  { campoOficial: 'Nome social', tabela: 'alunos', coluna: 'nome_social', transformacao: 'direta (opcional)', elementoXml: 'Diplomado.NomeSocial' },
  { campoOficial: 'Sexo', tabela: 'alunos', coluna: 'sexo', transformacao: 'enum M/F (normalizarSexo)', elementoXml: 'Diplomado.Sexo' },
  { campoOficial: 'Nacionalidade', tabela: 'alunos', coluna: 'nacionalidade', transformacao: 'direta', elementoXml: 'Diplomado.Nacionalidade' },
  { campoOficial: 'Naturalidade (município)', tabela: 'alunos', coluna: 'naturalidade + naturalidade_codigo_ibge + naturalidade_uf (+ naturalidade_estrangeira)', transformacao: 'normalizada (GMunicipio: IBGE 7d+UF ou estrangeiro)', elementoXml: 'Diplomado.Naturalidade' },
  { campoOficial: 'CPF', tabela: 'alunos', coluna: 'cpf', transformacao: 'normalizada → 11 dígitos', elementoXml: 'Diplomado.CPF' },
  { campoOficial: 'RG', tabela: 'alunos', coluna: 'rg + orgao_emissor + rg_uf', transformacao: 'normalizada (número 4-15 alfanum; UF enum)', elementoXml: 'Diplomado.RG' },
  { campoOficial: 'Data de nascimento', tabela: 'alunos', coluna: 'data_nascimento', transformacao: 'normalizada → AAAA-MM-DD', elementoXml: 'Diplomado.DataNascimento' },
];

export const MAPA_CURSO: MapeamentoCampo[] = [
  { campoOficial: 'Nome do curso', tabela: 'alunos', coluna: 'curso', transformacao: 'direta (junta com cursos.nome)', elementoXml: 'DadosCurso.NomeCurso' },
  { campoOficial: 'Código e-MEC do curso', tabela: 'cursos', coluna: 'codigo_emec', transformacao: 'direta (uint)', elementoXml: 'DadosCurso.CodigoCursoEMEC' },
  { campoOficial: 'Modalidade', tabela: 'cursos', coluna: 'modalidade', transformacao: 'enum Presencial/EAD', elementoXml: 'DadosCurso.Modalidade' },
  { campoOficial: 'Título conferido', tabela: 'cursos', coluna: 'titulo_conferido (ou outro_titulo)', transformacao: 'enum TTitulo/OutroTitulo', elementoXml: 'DadosCurso.TituloConferido' },
  { campoOficial: 'Grau conferido', tabela: 'cursos', coluna: 'grau_conferido', transformacao: 'enum TGrauConferido', elementoXml: 'DadosCurso.GrauConferido' },
  { campoOficial: 'Endereço do curso', tabela: 'cursos', coluna: 'endereco_json — se ausente usa o endereço da IES (campus único)', transformacao: 'derivada (fallback IES)', elementoXml: 'DadosCurso.EnderecoCurso' },
  { campoOficial: 'Autorização', tabela: 'cursos', coluna: 'autorizacao_json {tipo,numero,data}', transformacao: 'bloco TAtoRegulatorio', elementoXml: 'DadosCurso.Autorizacao' },
  { campoOficial: 'Reconhecimento', tabela: 'cursos', coluna: 'reconhecimento_json {tipo,numero,data}', transformacao: 'bloco TAtoRegulatorio', elementoXml: 'DadosCurso.Reconhecimento' },
  { campoOficial: 'Carga horária total do curso', tabela: 'cursos', coluna: 'carga_horaria', transformacao: 'normalizada → HoraAula|HoraRelogio', elementoXml: 'HistoricoEscolar.CargaHorariaCurso' },
];

export const MAPA_IES_EMISSORA: MapeamentoCampo[] = [
  { campoOficial: 'Nome da IES', tabela: 'ies', coluna: 'nome', transformacao: 'direta', elementoXml: 'IesEmissora.Nome' },
  { campoOficial: 'Código e-MEC da IES', tabela: 'ies', coluna: 'codigo_emec', transformacao: 'direta (uint)', elementoXml: 'IesEmissora.CodigoMEC' },
  { campoOficial: 'CNPJ', tabela: 'ies', coluna: 'cnpj', transformacao: 'normalizada → 14 dígitos', elementoXml: 'IesEmissora.CNPJ' },
  { campoOficial: 'Endereço', tabela: 'ies', coluna: 'logradouro…cep + codigo_municipio/nome_municipio/uf', transformacao: 'bloco TEndereco', elementoXml: 'IesEmissora.Endereco' },
  { campoOficial: 'Credenciamento', tabela: 'ies', coluna: 'credenciamento_json {tipo,numero,data}', transformacao: 'bloco TAtoRegulatorio', elementoXml: 'IesEmissora.Credenciamento' },
];

export const MAPA_HISTORICO: MapeamentoCampo[] = [
  { campoOficial: 'Código do currículo', tabela: 'cursos', coluna: 'id', transformacao: "derivada: 'CUR-' + id (código interno da IES, livre no XSD)", elementoXml: 'HistoricoEscolar.CodigoCurriculo' },
  { campoOficial: 'Disciplinas (entradas)', tabela: 'historico_disciplinas', coluna: 'disciplina, periodo, ch, nota, status, docente, titulacao', transformacao: 'por linha: código derivado do nome (slug), CH normalizada, nota→TNota/conceito, status→Aprovado/Pendente/Reprovado, docente+titulação enum', elementoXml: 'HistoricoEscolar.ElementosHistorico.Disciplina' },
  { campoOficial: 'Data/hora de emissão', tabela: '—', coluna: '—', transformacao: 'derivada: data/hora atual de geração (Brasília)', elementoXml: 'HistoricoEscolar.DataEmissaoHistorico/HoraEmissaoHistorico' },
  { campoOficial: 'Situação atual do discente', tabela: 'alunos', coluna: 'ano_conclusao/data_colacao + diplomas.emitido_em (ou data do processo)', transformacao: 'derivada: Formado{DataConclusaoCurso,DataColacaoGrau,DataExpedicaoDiploma}', elementoXml: 'HistoricoEscolar.SituacaoAtualDiscente.Formado' },
  { campoOficial: 'ENADE', tabela: '—', coluna: '—', transformacao: 'elemento vazio (sequência 0..n do XSD) até a IES informar edições', elementoXml: 'HistoricoEscolar.ENADE' },
  { campoOficial: 'CH integralizada', tabela: 'historico_disciplinas', coluna: 'ch (linhas Aprovadas/Cumpridas)', transformacao: 'derivada: soma das CH normalizadas', elementoXml: 'HistoricoEscolar.CargaHorariaCursoIntegralizada' },
  { campoOficial: 'Ingresso no curso', tabela: 'alunos', coluna: 'data_vestibular (ou ano_ingresso→01/01)', transformacao: 'normalizada/derivada + enum TFormaAcessoCurso', elementoXml: 'HistoricoEscolar.IngressoCurso' },
  { campoOficial: 'Código de validação do histórico', tabela: 'diplomas_digitais', coluna: 'codigo_validacao_historico', transformacao: 'derivada: eMEC-emissora + "." + 16 hex aleatórios (gerado 1x, persistido)', elementoXml: 'SegurancaHistorico.CodigoValidacao' },
];

export const MAPA_DOCUMENTACAO_ACADEMICA: MapeamentoCampo[] = [
  ...MAPA_DIPLOMADO.map((m) => ({ ...m, elementoXml: m.elementoXml.replace('Diplomado', 'DadosDiploma.Diplomado') })),
  ...MAPA_CURSO.map((m) => ({ ...m, elementoXml: m.elementoXml.replace('DadosCurso', 'RegistroReq.DadosDiploma.DadosCurso') })),
  ...MAPA_IES_EMISSORA.map((m) => ({ ...m, elementoXml: m.elementoXml.replace('IesEmissora', 'RegistroReq.DadosDiploma.IesEmissora') })),
  { campoOficial: 'Filiação (genitores)', tabela: 'alunos', coluna: 'mae_nome/mae_sexo/pai_nome/pai_sexo', transformacao: 'direta (≥1 Genitor obrigatório: Nome+Sexo)', elementoXml: 'RegistroReq.DadosPrivadosDiplomado.Filiacao.Genitor' },
  { campoOficial: 'Histórico escolar embutido', tabela: 'historico_disciplinas', coluna: '(mesmo mapa do histórico)', transformacao: 'mesma transformação do MAPA_HISTORICO (THistoricoEscolar)', elementoXml: 'RegistroReq.DadosPrivadosDiplomado.HistoricoEscolar' },
  { campoOficial: 'Documentação comprobatória', tabela: 'aluno_documentos', coluna: 'nome/caminho (+tipo mapeado)', transformacao: 'arquivo PDF lido e embutido em base64 (TPdfA); sem documento → pendência', elementoXml: 'RegistroReq.DocumentacaoComprobatoria.Documento' },
];

/** Exposição para UI/documentação (Pendências cita o mapa). */
export const TODOS_MAPAS = {
  diplomado: MAPA_DIPLOMADO,
  curso: MAPA_CURSO,
  iesEmissora: MAPA_IES_EMISSORA,
  historico: MAPA_HISTORICO,
  documentacaoAcademica: MAPA_DOCUMENTACAO_ACADEMICA,
};

// ---------- enums do XSD usados pelos geradores ----------

export const TITULACOES_XSD = ['Tecnólogo', 'Graduação', 'Especialização', 'Mestrado', 'Doutorado'] as const;

/** Titulação livre → enum TTitulacao. Null = não mapeável (pendência). */
export function mapearTitulacao(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (s.startsWith('doutor')) return 'Doutorado';
  if (s.startsWith('mestre') || s.includes('mestrado')) return 'Mestrado';
  if (s.includes('especial')) return 'Especialização';
  if (s.includes('tecnologo') || s.includes('tecnólogo')) return 'Tecnólogo';
  if (s.includes('gradua')) return 'Graduação';
  return null;
}

const FORMAS_ACESSO: Record<string, string> = {
  vestibular: 'Vestibular',
  enem: 'Enem',
  'avaliação seriada': 'Avaliação Seriada',
  'avaliacao seriada': 'Avaliação Seriada',
  'seleção simplificada': 'Seleção Simplificada',
  'selecao simplificada': 'Seleção Simplificada',
  'transferência ex officio': 'Transferência Ex Officio',
  'transferencia ex officio': 'Transferência Ex Officio',
  'decisão judicial': 'Decisão judicial',
  'decisao judicial': 'Decisão judicial',
  'vagas remanescentes': 'Seleção para Vagas Remanescentes',
  'programas especiais': 'Seleção para Vagas de Programas Especiais',
  'egresso': 'Egresso BI/LI',
  'pec-g': 'PEC-G',
};

/** Forma de ingresso livre → enum TFormaAcessoCurso. Null = pendência. */
export function mapearFormaAcesso(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (FORMAS_ACESSO[s]) return FORMAS_ACESSO[s];
  for (const [k, val] of Object.entries(FORMAS_ACESSO)) {
    if (s.includes(k)) return val;
  }
  return null;
}

/** Código de unidade curricular determinístico a partir do nome (TCodigoUnidadeCurricular [\w\d\-.]+). */
export function codigoDisciplinaDerivado(nome: string, usado: Set<string>): string {
  const base = nome
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'DISC';
  let cod = base;
  let i = 2;
  while (usado.has(cod)) cod = `${base}-${i++}`;
  usado.add(cod);
  return cod;
}
