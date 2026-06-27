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
}

export interface UsuarioList extends Usuario {
  created_at: string;
  updated_at: string;
}

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
  created_by_nome?: string | null;
  created_by_codigo?: string | null;
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

export interface DeclaracaoRow {
  id: number;
  aluno_id: number;
  codigo_verificacao: string;
  hash_conteudo: string;
  emitido_por: number;
  emitido_em: string;
  enviado_web: number;
  aluno_nome: string;
  aluno_matricula: string;
  emitido_por_nome: string;
  emitido_por_codigo?: string;
}

export interface DeclaracaoEmitida {
  declaracao: {
    id: number;
    codigo_verificacao: string;
    hash_conteudo: string;
    enviado_web: number;
  };
  pdfPath: string;
  enviadoWeb: boolean;
}

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
