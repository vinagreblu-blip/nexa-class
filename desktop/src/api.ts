import type {
  Aluno,
  AlunoInput,
  AlunoDocumento,
  ApiResult,
  DeclaracaoEmitida,
  DeclaracaoRow,
  Disciplina,
  DisciplinaInput,
  Docente,
  DocenteInput,
  HistoricoDisciplina,
  HistoricoDisciplinaInput,
  Usuario,
  UsuarioInput,
} from './types';

export interface DesktopApi {
  auth: {
    login: (username: string, password: string) => Promise<ApiResult<Usuario>>;
    logout: () => Promise<ApiResult<true>>;
    sessao: () => Promise<ApiResult<Usuario | null>>;
    alterarSenha: (atual: string, nova: string) => Promise<ApiResult<true>>;
    solicitarRecuperacao: (email: string) => Promise<ApiResult<{ enviado: boolean }>>;
  };
  smtp: {
    obter: () => Promise<ApiResult<{ provedor: string; email: string; senha: string } | null>>;
    salvar: (config: { provedor: string; email: string; senha: string }) => Promise<ApiResult<{ provedor: string; email: string; senha: string }>>;
  };
  alunos: {
    listar: (busca?: string) => Promise<ApiResult<Aluno[]>>;
    buscar: (id: number) => Promise<ApiResult<Aluno>>;
    criar: (input: AlunoInput) => Promise<ApiResult<Aluno>>;
    atualizar: (id: number, input: AlunoInput) => Promise<ApiResult<Aluno>>;
    excluir: (id: number) => Promise<ApiResult<true>>;
  };
  usuarios: {
    listar: () => Promise<ApiResult<Usuario[]>>;
    criar: (input: UsuarioInput) => Promise<ApiResult<Usuario>>;
    atualizar: (
      id: number,
      input: { username: string; nome: string; email?: string; role: 'admin' | 'operador'; password?: string; ativo?: boolean }
    ) => Promise<ApiResult<Usuario>>;
    excluir: (id: number) => Promise<ApiResult<true>>;
    trocarFoto: (id: number) => Promise<ApiResult<Usuario>>;
    foto: (id: number) => Promise<ApiResult<{ dataUrl: string | null }>>;
    resetarSenha: (id: number, masterPassword: string) => Promise<ApiResult<{ senhaTemporaria: string }>>;
  };
  declaracoes: {
    emitir: (alunoId: number) => Promise<ApiResult<DeclaracaoEmitida>>;
    listar: (alunoId?: number) => Promise<ApiResult<DeclaracaoRow[]>>;
    excluir: (id: number, senha: string) => Promise<ApiResult<{ webOk: boolean }>>;
    baixar: (id: number) => Promise<ApiResult<{ salvoPath: string }>>;
  };
  historico: {
    listar: (alunoId: number) => Promise<ApiResult<HistoricoDisciplina[]>>;
    criar: (alunoId: number, input: HistoricoDisciplinaInput) => Promise<ApiResult<HistoricoDisciplina>>;
    atualizar: (id: number, input: HistoricoDisciplinaInput) => Promise<ApiResult<HistoricoDisciplina>>;
    excluir: (id: number) => Promise<ApiResult<true>>;
    gerarPdf: (alunoId: number) => Promise<ApiResult<{ pdfPath: string; enviadoWeb: boolean }>>;
    gerarXml: (alunoId: number) => Promise<ApiResult<{ xmlPath: string }>>;
    mover: (id: number, direcao: 'up' | 'down') => Promise<ApiResult<true>>;
  };
  docentes: {
    listar: (busca?: string) => Promise<ApiResult<Docente[]>>;
    criar: (input: DocenteInput) => Promise<ApiResult<Docente>>;
    atualizar: (id: number, input: DocenteInput, senha: string) => Promise<ApiResult<Docente>>;
    excluir: (id: number, senha: string) => Promise<ApiResult<true>>;
  };
  disciplinas: {
    listar: (busca?: string) => Promise<ApiResult<Disciplina[]>>;
    criar: (input: DisciplinaInput) => Promise<ApiResult<Disciplina>>;
    atualizar: (id: number, input: DisciplinaInput, senha: string) => Promise<ApiResult<Disciplina>>;
    excluir: (id: number, senha: string) => Promise<ApiResult<true>>;
  };
  documentos: {
    listar: (alunoId: number) => Promise<ApiResult<AlunoDocumento[]>>;
    adicionar: (alunoId: number) => Promise<ApiResult<AlunoDocumento[]>>;
    excluir: (id: number) => Promise<ApiResult<true>>;
    converterXml: (id: number) => Promise<ApiResult<{ xmlPath: string }>>;
    visualizarXml: (id: number) => Promise<ApiResult<{ nome: string; conteudo: string }>>;
    baixar: (id: number, tipo: 'xml' | 'pdf') => Promise<ApiResult<{ salvoPath: string }>>;
  };
  extracao: {
    extrairDadosDocumento: () => Promise<ApiResult<{
      nome: string | null; cpf: string | null; rg: string | null;
      orgaoEmissor: string | null;
      naturalidade: string | null; nacionalidade: string | null;
      dataNascimento: string | null; sexo: string | null;
    }>>;
  };
  conversoes: {
    pdfParaXml: () => Promise<ApiResult<{ caminho: string }>>;
    imgParaXml: () => Promise<ApiResult<{ caminho: string }>>;
    xmlParaPdf: () => Promise<ApiResult<{ caminho: string }>>;
  };
  assinatura: {
    obter: () => Promise<ApiResult<{ id: number; nome_signatario: string; cargo: string; imagem_path: string | null; certificado_path: string | null; ativo: number } | null>>;
    salvar: (input: { nome_signatario: string; cargo: string }) => Promise<ApiResult<{ id: number; nome_signatario: string; cargo: string; imagem_path: string | null; certificado_path: string | null; ativo: number }>>;
    uploadCert: () => Promise<ApiResult<{ id: number; nome_signatario: string; cargo: string; imagem_path: string | null; certificado_path: string | null; ativo: number }>>;
    assinarXml: (xmlContent: string, senhaPfx: string) => Promise<ApiResult<{ xml: string }>>;
  };
}

declare global {
  interface Window {
    api: DesktopApi;
  }
}

export const api: DesktopApi = window.api;
export type {
  Aluno,
  AlunoInput,
  Usuario,
  UsuarioInput,
  DeclaracaoEmitida,
  DeclaracaoRow,
  HistoricoDisciplina,
  HistoricoDisciplinaInput,
  Docente,
  DocenteInput,
  Disciplina,
  DisciplinaInput,
  AlunoDocumento,
};
