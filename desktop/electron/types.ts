export type Role = 'admin' | 'operador';

export interface Usuario {
  id: number;
  codigo: string;
  username: string;
  nome: string;
  email: string | null;
  role: Role;
  foto_path: string | null;
  ativo: number;
  senha_temporaria: number;
  created_at: string;
  updated_at: string;
}

export type UsuarioPublico = Omit<Usuario, 'created_at' | 'updated_at'>;

export interface UsuarioInput {
  username: string;
  password: string;
  nome: string;
  email?: string;
  role: Role;
}

export interface Aluno {
  id: number;
  matricula: string;
  nome: string;
  cpf: string | null;
  rg: string | null;
  nacionalidade: string | null;
  naturalidade: string | null;
  cidade: string | null;
  sexo: string | null;
  orgao_emissor: string | null;
  turno: string | null;
  forma_ingresso: string | null;
  data_vestibular: string | null;
  data_colacao: string | null;
  email: string | null;
  telefone: string | null;
  curso: string | null;
  faculdade: string | null;
  ano_ingresso: string | null;
  ano_conclusao: string | null;
  data_nascimento: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlunoInput {
  matricula: string;
  nome: string;
  cpf?: string;
  rg?: string;
  nacionalidade?: string;
  naturalidade?: string;
  cidade?: string;
  sexo?: string;
  orgao_emissor?: string;
  turno?: string;
  forma_ingresso?: string;
  data_vestibular?: string;
  data_colacao?: string;
  email?: string;
  telefone?: string;
  curso?: string;
  faculdade?: string;
  ano_ingresso?: string;
  ano_conclusao?: string;
  data_nascimento?: string;
  origem?: string;
}

export interface HistoricoDisciplina {
  id: number;
  aluno_id: number;
  periodo: string;
  disciplina: string;
  docente: string;
  titulacao: string;
  ch: string;
  nota: string;
  ft: string;
  status: string;
  ordem: number;
}

export interface HistoricoDisciplinaInput {
  periodo: string;
  disciplina: string;
  docente: string;
  titulacao: string;
  ch: string;
  nota: string;
  ft: string;
  status: string;
}

export interface Docente {
  id: number;
  nome: string;
  titulacao: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocenteInput {
  nome: string;
  titulacao: string;
}

export interface Disciplina {
  id: number;
  nome: string;
  docente_id: number | null;
  docente_nome: string | null;
  ch: string | null;
  created_at: string;
  updated_at: string;
}

export interface DisciplinaInput {
  nome: string;
  docente_id: number | null;
  ch: string;
}

export interface AlunoDocumento {
  id: number;
  aluno_id: number;
  nome: string;
  caminho: string;
  xml_path: string | null;
  convertido: number;
  created_at: string;
}

/** Tipo de declaração de autenticidade. */
export type TipoDeclaracao = 'generico' | 'historico' | 'diploma';

export interface Declaracao {
  id: number;
  aluno_id: number;
  codigo_verificacao: string;
  hash_conteudo: string;
  emitido_por: number;
  emitido_em: string;
  enviado_web: number;
  /** 'generico' (default) | 'historico' | 'diploma' */
  tipo?: TipoDeclaracao;
  /** Quando tipo='diploma', referência ao diploma que esta declaração atesta. */
  diploma_id?: number | null;
}

/** Linha de declaração com JOIN de aluno/usuário (usada na listagem da UI). */
export interface DeclaracaoRow {
  id: number;
  aluno_id: number;
  codigo_verificacao: string;
  hash_conteudo: string;
  emitido_por: number;
  emitido_em: string;
  enviado_web: number;
  tipo?: string;
  diploma_id?: number | null;
  aluno_nome: string;
  aluno_matricula: string;
  emitido_por_nome: string;
  emitido_por_codigo?: string;
  pdf_caminho?: string | null;
}

/** Linha de diploma com JOIN (usada na listagem da UI). */
export interface DiplomaRow {
  id: number;
  aluno_id: number;
  codigo_verificacao: string;
  hash_conteudo: string;
  emitido_por: number;
  emitido_em: string;
  pdf_caminho?: string | null;
  aluno_nome: string;
  aluno_matricula: string;
  emitido_por_nome: string;
}

export interface Sessao {
  usuario: UsuarioPublico;
}

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface AtaColacaoConcluinte {
  id: number;
  matricula: string;
  nome: string;
  cpf: string | null;
  rg: string | null;
  curso: string | null;
  faculdade: string | null;
  ano_conclusao: string | null;
  data_colacao: string | null;
  ata_id: number | null;
  numero_ata: string | null;
  emitido_em: string | null;
}

export interface AtaColacaoDados {
  aluno_id: number;
  numero_ata?: string;
  data?: string;
  horario?: string;
  plataforma?: string;
  instituicao?: string;
  cidade?: string;
  estado?: string;
  grau?: string;
  modalidade?: string;
  presidente_nome?: string;
  presidente_cargo?: string;
  diretor_nome?: string;
  diretor_cargo?: string;
}

export interface DeclaracaoEmitida {
  declaracao: Declaracao;
  pdfPath: string;
  enviadoWeb: boolean;
}

export const IPC_CHANNELS = {
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_SESSAO: 'auth:sessao',
  AUTH_ALTERAR_SENHA: 'auth:alterar-senha',
  AUTH_SOLICITAR_RECUPERACAO: 'auth:solicitar-recuperacao',
  AUTH_REDEFINIR_COM_TOKEN: 'auth:redefinir-com-token',
  DASHBOARD_OBTER: 'dashboard:obter',
  DASHBOARD_REVOGAR: 'dashboard:revogar',
  SMTP_OBTER: 'smtp:obter',
  SMTP_SALVAR: 'smtp:salvar',
  ALUNO_LISTAR: 'aluno:listar',
  ALUNO_BUSCAR: 'aluno:buscar',
  ALUNO_CRIAR: 'aluno:criar',
  ALUNO_ATUALIZAR: 'aluno:atualizar',
  ALUNO_EXCLUIR: 'aluno:excluir',
  USUARIO_LISTAR: 'usuario:listar',
  USUARIO_CRIAR: 'usuario:criar',
  USUARIO_ATUALIZAR: 'usuario:atualizar',
  USUARIO_EXCLUIR: 'usuario:excluir',
  USUARIO_TROCAR_FOTO: 'usuario:trocar-foto',
  USUARIO_FOTO: 'usuario:foto',
  USUARIO_RESETAR_SENHA: 'usuario:resetar-senha',
  DECLARACAO_EMITIR: 'declaracao:emitir',
  DECLARACAO_LISTAR: 'declaracao:listar',
  DECLARACAO_EXCLUIR: 'declaracao:excluir',
  DECLARACAO_BAIXAR: 'declaracao:baixar',
  HISTORICO_LISTAR: 'historico:listar',
  HISTORICO_CRIAR: 'historico:criar',
  HISTORICO_ATUALIZAR: 'historico:atualizar',
  HISTORICO_EXCLUIR: 'historico:excluir',
  HISTORICO_GERAR_PDF: 'historico:gerar-pdf',
  HISTORICO_GERAR_XML: 'historico:gerar-xml',
  HISTORICO_MOVER: 'historico:mover',
  DOCENTE_LISTAR: 'docente:listar',
  DOCENTE_CRIAR: 'docente:criar',
  DOCENTE_ATUALIZAR: 'docente:atualizar',
  DOCENTE_EXCLUIR: 'docente:excluir',
  DISCIPLINA_LISTAR: 'disciplina:listar',
  DISCIPLINA_CRIAR: 'disciplina:criar',
  DISCIPLINA_ATUALIZAR: 'disciplina:atualizar',
  DISCIPLINA_EXCLUIR: 'disciplina:excluir',
  DOCUMENTO_LISTAR: 'documento:listar',
  DOCUMENTO_ADICIONAR: 'documento:adicionar',
  DOCUMENTO_EXCLUIR: 'documento:excluir',
  DOCUMENTO_CONVERTER_XML: 'documento:converter-xml',
  DOCUMENTO_VISUALIZAR_XML: 'documento:visualizar-xml',
  DOCUMENTO_BAIXAR: 'documento:baixar',
  EXTRAIR_DADOS_DOC: 'extrair:dados-doc',
  CONVERSAO_PDF_XML: 'conversao:pdf-xml',
  CONVERSAO_IMG_XML: 'conversao:img-xml',
  CONVERSAO_XML_PDF: 'conversao:xml-pdf',
  ASSINATURA_OBTER: 'assinatura:obter',
  ASSINATURA_SALVAR: 'assinatura:salvar',
  ASSINATURA_UPLOAD_CERT: 'assinatura:upload-cert',
  ASSINATURA_LISTAR_CERTS_A3: 'assinatura:listar-certs-a3',
  ASSINATURA_SALVAR_CERT_A3: 'assinatura:salvar-cert-a3',
  ASSINATURA_TESTAR_A3: 'assinatura:testar-a3',
  ASSINATURA_ASSINAR_XML: 'assinatura:assinar-xml',
  ASSINATURA_PREVIEW_IMAGEM: 'assinatura:preview-imagem',
  CLOUD_STATUS: 'cloud:status',
  CLOUD_SALVAR: 'cloud:salvar',
  CLOUD_SYNC: 'cloud:sync',
  DIPLOMA_EMITIR: 'diploma:emitir',
  DIPLOMA_LISTAR: 'diploma:listar',
  DIPLOMA_EXCLUIR: 'diploma:excluir',
  DIPLOMA_BAIXAR: 'diploma:baixar',
  DIPLOMA_GERAR_XML: 'diploma:gerar-xml',
  ATA_COLACAO_LISTAR_CONCLUINTES: 'ata-colacao:listar-concluintes',
  ATA_COLACAO_OBTER: 'ata-colacao:obter',
  ATA_COLACAO_SALVAR: 'ata-colacao:salvar',
  ATA_COLACAO_GERAR_PDF: 'ata-colacao:gerar-pdf',
  CURSO_LIVRE_LISTAR: 'curso-livre:listar',
  CURSO_LIVRE_CRIAR: 'curso-livre:criar',
  CURSO_LIVRE_ATUALIZAR: 'curso-livre:atualizar',
  CURSO_LIVRE_EXCLUIR: 'curso-livre:excluir',
  CURSO_LIVRE_VERIFICAR: 'curso-livre:verificar',
  CURSO_LIVRE_LISTAR_ALUNOS: 'curso-livre:listar-alunos',
  CURSO_LIVRE_VINCULAR_ALUNO: 'curso-livre:vincular-aluno',
  CURSO_LIVRE_DESVINCULAR_ALUNO: 'curso-livre:desvincular-aluno',
  CERTIFICADO_GERAR: 'certificado:gerar',
  CERTIFICADO_LISTAR: 'certificado:listar',
  CERTIFICADO_BAIXAR: 'certificado:baixar',
  DIPLOMAS_DIGITAIS_LISTAR: 'diplomas-digitais:listar',
  DIPLOMAS_DIGITAIS_LISTAR_APTOS: 'diplomas-digitais:listar-aptos',
  DIPLOMAS_DIGITAIS_CRIAR: 'diplomas-digitais:criar',
  DIPLOMAS_DIGITAIS_OBTER: 'diplomas-digitais:obter',
  DIPLOMAS_DIGITAIS_PENDENCIAS: 'diplomas-digitais:pendencias',
  DIPLOMAS_DIGITAIS_COMPLETAR_ALUNO: 'diplomas-digitais:completar-aluno',
  DIPLOMAS_DIGITAIS_GERAR_XML: 'diplomas-digitais:gerar-xml',
  IES_LISTAR: 'ies:listar',
  IES_SALVAR: 'ies:salvar',
  CURSO_GRADUACAO_LISTAR: 'curso-graduacao:listar',
  CURSO_GRADUACAO_SALVAR: 'curso-graduacao:salvar',
  DADOS_ATUALIZADOS: 'dados:atualizados',
  CONEXAO_ESTADO: 'conexao:estado',
} as const;
