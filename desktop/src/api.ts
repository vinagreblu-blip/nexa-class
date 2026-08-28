import type {
  Aluno,
  AlunoInput,
  AlunoDocumento,
  ApiResult,
  AtaColacaoConcluinte,
  AtaColacaoDados,
  CursoLivreInput,
  CursoLivreRow,
  DeclaracaoEmitida,
  DeclaracaoRow,
  DiplomaRow,
  Disciplina,
  DisciplinaInput,
  Docente,
  DocenteInput,
  HistoricoDisciplina,
  HistoricoDisciplinaInput,
  Usuario,
  UsuarioInput,
} from './types';

/**
 * Métricas retornadas pelo Dashboard admin. Mantida em sync com
 * `desktop/electron/ipc/dashboard.ts:MetricasDashboard`.
 */
export interface MetricasDashboard {
  contadores: {
    alunos: number;
    usuariosAtivos: number;
    declaracoes: number;
    diplomas: number;
    docentes: number;
    disciplinas: number;
    cursosLivres: number;
  };
  atividadeRecente: {
    usuarios: Array<{ username: string; nome: string; role: string; updated_at: string | null }>;
    declaracoes: Array<{
      emitido_em: string;
      aluno_nome: string;
      aluno_matricula: string;
      emitido_por_nome: string;
    }>;
    alunos: Array<{
      nome: string;
      matricula: string;
      curso: string | null;
      created_at: string | null;
      cadastrado_por_nome: string | null;
    }>;
    diplomas: Array<{
      emitido_em: string;
      aluno_nome: string;
      aluno_matricula: string;
      emitido_por_nome: string;
    }>;
    atas: Array<{
      emitido_em: string | null;
      aluno_nome: string;
      aluno_matricula: string;
    }>;
    cursosLivres: Array<{
      nome: string;
      carga_horaria: string | null;
      created_at: string;
    }>;
    matriculasCursosLivres: Array<{
      created_at: string;
      curso_nome: string;
      aluno_nome: string;
      aluno_matricula: string;
    }>;
  };
  status: {
    cloudSync: { ativo: boolean; ultimoSyncEm: string | null; ultimoSyncOk: boolean | null };
    cloudAuth: {
      autenticado: boolean;
      identityEmail: string | null;
      machineId: string | null;
      ultimoErro: string | null;
      revogada: boolean;
    };
    smtp: boolean;
    sentry: boolean;
    apiKeyForte: boolean;
    senhaMasterForte: boolean;
    userDataBytes: number;
    appVersao: string;
  };
  instalacoes: Array<{
    machine_id: string;
    hostname: string | null;
    app_versao: string | null;
    identity_email: string | null;
    revoked: number;
    last_seen: string | null;
  }>;
}

export interface DesktopApi {
  auth: {
    login: (username: string, password: string) => Promise<ApiResult<Usuario>>;
    logout: () => Promise<ApiResult<true>>;
    sessao: () => Promise<ApiResult<Usuario | null>>;
    alterarSenha: (atual: string, nova: string) => Promise<ApiResult<true>>;
    solicitarRecuperacao: (email: string) => Promise<ApiResult<{ enviado: boolean }>>;
    redefinirComToken: (input: {
      email: string;
      codigo: string;
      novaSenha: string;
    }) => Promise<ApiResult<true>>;
    dashboard: {
      obter: () => Promise<ApiResult<MetricasDashboard>>;
      revogar: (machineId: string) => Promise<ApiResult<true>>;
    };
  };
  smtp: {
    obter: () => Promise<ApiResult<{ provedor: string; email: string; senha: string } | null>>;
    salvar: (config: { provedor: string; email: string; senha: string }) => Promise<ApiResult<{ provedor: string; email: string; senha: string }>>;
  };
  alunos: {
    listar: (busca?: string, origem?: string) => Promise<ApiResult<Aluno[]>>;
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
    emitir: (
      alunoId: number,
      semAssinatura?: boolean,
      tipo?: 'generico' | 'historico' | 'diploma',
      diplomaId?: number,
      senhaPfx?: string,
      formato?: 'pdf' | 'xml'
    ) => Promise<ApiResult<DeclaracaoEmitida>>;
    listar: (alunoId?: number) => Promise<ApiResult<DeclaracaoRow[]>>;
    excluir: (id: number, senha: string) => Promise<ApiResult<{ webOk: boolean }>>;
    baixar: (id: number) => Promise<ApiResult<{ salvoPath: string }>>;
  };
  diplomas: {
    emitir: (alunoId: number, semAssinatura?: boolean, senhaPfx?: string) => Promise<ApiResult<DiplomaRow>>;
    listar: (alunoId?: number) => Promise<ApiResult<DiplomaRow[]>>;
    excluir: (id: number, senha: string) => Promise<ApiResult<true>>;
    baixar: (id: number) => Promise<ApiResult<{ salvoPath: string }>>;
    gerarXml: (id: number, senhaPfx?: string) => Promise<ApiResult<{ xmlPath: string; aviso?: string }>>;
  };
  ataColacao: {
    listarConcluintes: (busca?: string) => Promise<ApiResult<AtaColacaoConcluinte[]>>;
    obter: (alunoId: number) => Promise<ApiResult<AtaColacaoDados | null>>;
    salvar: (dados: AtaColacaoDados) => Promise<ApiResult<AtaColacaoDados>>;
    gerarPdf: (alunoId: number) => Promise<ApiResult<{ pdfPath: string }>>;
  };
  cursosLivres: {
    verificar: (senha: string) => Promise<ApiResult<true>>;
    listar: (busca?: string) => Promise<ApiResult<CursoLivreRow[]>>;
    criar: (input: CursoLivreInput) => Promise<ApiResult<CursoLivreRow>>;
    atualizar: (id: number, input: CursoLivreInput) => Promise<ApiResult<CursoLivreRow>>;
    excluir: (id: number) => Promise<ApiResult<true>>;
    listarAlunos: (cursoLivreId: number) => Promise<ApiResult<any[]>>;
    vincularAluno: (cursoLivreId: number, alunoId: number) => Promise<ApiResult<true>>;
    desvincularAluno: (vinculoId: number) => Promise<ApiResult<true>>;
  };
  certificados: {
    gerar: (cursoLivreId: number, alunoId: number, senhaPfx?: string) => Promise<ApiResult<{ id: number; pdfPath: string; codigo_verificacao: string }>>;
    listar: (cursoLivreId: number) => Promise<ApiResult<any[]>>;
    baixar: (id: number) => Promise<ApiResult<{ salvoPath: string }>>;
  };
  diplomasDigitais: {
    listar: (busca?: string) => Promise<ApiResult<any[]>>;
    listarAptos: (busca?: string) => Promise<ApiResult<any[]>>;
    criar: (alunoId: number) => Promise<ApiResult<any>>;
    obter: (id: number) => Promise<ApiResult<any>>;
    pendencias: (alunoId: number) => Promise<ApiResult<any[]>>;
    completarAluno: (input: {
      alunoId: number;
      cpf?: string;
      sexo?: string;
      nacionalidade?: string;
      rg?: string;
      rgUf?: string;
      dataNascimento?: string;
      naturalidadeCodigoIbge?: string;
      naturalidadeUf?: string;
      naturalidadeEstrangeira?: string;
      dataColacao?: string;
    }) => Promise<ApiResult<true>>;
    gerarXml: (id: number, artefato: 'historico_escolar' | 'documentacao_academica') => Promise<ApiResult<{ valido: boolean; erros: string[]; arquivoId: number }>>;
    assinar: (id: number, artefato: 'historico_escolar' | 'documentacao_academica', senhaPfx?: string) => Promise<ApiResult<{ arquivoId: number; carimbos?: string[]; avisoCarimbo?: string }>>;
    registrar: (id: number, registro: {
      livro: string;
      numeroRegistro?: string;
      numeroFolha?: string;
      numeroSequencia?: string;
      processoDiploma?: string;
      dataExpedicaoDiploma: string;
      dataRegistroDiploma: string;
      responsavel: { nome: string; cpf: string; matricula?: string };
      codigoValidacao: string;
      informacoesAdicionais?: string;
    }) => Promise<ApiResult<{ valido: boolean }>>;
    publicar: (id: number) => Promise<ApiResult<true>>;
    anular: (id: number, motivo: string, senhaMaster: string, anotacao?: string) => Promise<ApiResult<true>>;
    gerarListaAnulados: (input: { numeroSequencia: number; dataMaximaProximaAtualizacao: string }) => Promise<ApiResult<{ salvoPath: string; anulados: number }>>;
    gerarRvdd: (id: number) => Promise<ApiResult<{ salvoPath: string; pdfaAuto: boolean; veraPdfConforme: boolean | null }>>;
    gerarFiscalizacao: (input: { dataInicio: string; dataFim: string }) => Promise<ApiResult<{ salvoPath: string; diplomas: number }>>;
    abrirValidadorMec: () => Promise<ApiResult<true>>;
    baixarArquivo: (arquivoId: number) => Promise<ApiResult<{ salvoPath: string }>>;
    validarArtefato: (arquivoId: number) => Promise<ApiResult<any>>;
    registrarValidacaoMec: (id: number, resultado: 'valido' | 'invalido', observacoes?: string) => Promise<ApiResult<true>>;
    iesListar: () => Promise<ApiResult<any[]>>;
    iesSalvar: (input: any) => Promise<ApiResult<any>>;
    cursoGraduacaoListar: (iesId?: number) => Promise<ApiResult<any[]>>;
    cursoGraduacaoSalvar: (input: any) => Promise<ApiResult<any>>;
  };
  historico: {
    listar: (alunoId: number) => Promise<ApiResult<HistoricoDisciplina[]>>;
    criar: (alunoId: number, input: HistoricoDisciplinaInput) => Promise<ApiResult<HistoricoDisciplina>>;
    atualizar: (id: number, input: HistoricoDisciplinaInput) => Promise<ApiResult<HistoricoDisciplina>>;
    excluir: (id: number) => Promise<ApiResult<true>>;
    gerarPdf: (alunoId: number, semAssinatura?: boolean, senhaPfx?: string) => Promise<ApiResult<{ pdfPath: string; enviadoWeb: boolean }>>;
    gerarXml: (alunoId: number, senhaPfx?: string) => Promise<ApiResult<{ xmlPath: string; aviso?: string }>>;
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
    converterXml: (id: number) => Promise<ApiResult<{ xmlPath: string; aviso?: string }>>;
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
    obter: () => Promise<ApiResult<{ id: number; nome_signatario: string; cargo: string; imagem_path: string | null; certificado_path: string | null; certificado_tipo: 'A1' | 'A3' | null; certificado_a3_thumbprint: string | null; ativo: number } | null>>;
    salvar: (input: { nome_signatario: string; cargo: string }) => Promise<ApiResult<{ id: number; nome_signatario: string; cargo: string; imagem_path: string | null; certificado_path: string | null; certificado_tipo: 'A1' | 'A3' | null; certificado_a3_thumbprint: string | null; ativo: number }>>;
    uploadCert: (tipo?: string) => Promise<ApiResult<{ id: number; nome_signatario: string; cargo: string; imagem_path: string | null; certificado_path: string | null; certificado_tipo: 'A1' | 'A3' | null; certificado_a3_thumbprint: string | null; ativo: number }>>;
    listarCertsA3: () => Promise<ApiResult<{ thumbprint: string; subject: string; issuer: string; notBefore: string; notAfter: string; hasPrivateKey: boolean; keyAcessivel: boolean; algorithm: string; store: string }[]>>;
    testarA3: () => Promise<ApiResult<{ encontrado: boolean; certificados: { store: string; algorithm: string; keyAcessivel: boolean }[]; assinou: boolean; erro?: string }>>;
    salvarCertA3: (thumbprint: string) => Promise<ApiResult<{ id: number; nome_signatario: string; cargo: string; imagem_path: string | null; certificado_path: string | null; certificado_tipo: 'A1' | 'A3' | null; certificado_a3_thumbprint: string | null; ativo: number }>>;
    assinarXml: (xmlContent: string, senhaPfx: string) => Promise<ApiResult<{ xml: string }>>;
    previewImagem: () => Promise<ApiResult<{ dataUrl: string | null }>>;
    tsaObter: () => Promise<ApiResult<{ url: string; usuario: string; temSenha: boolean } | null>>;
    tsaSalvar: (input: { url: string; usuario?: string; senha?: string; manterSenhaAtual?: boolean }) => Promise<ApiResult<{ url: string; usuario: string; temSenha: boolean }>>;
    tsaTestar: () => Promise<ApiResult<{ genTime: string; bytes: number }>>;
    politicaObter: () => Promise<ApiResult<{ modo: 'padrao' | 'custom' | 'bes'; identificador: string; digestBase64: string; spuri: string; padraoIdentificador: string; padraoDigestBase64: string; padraoSpuri: string }>>;
    politicaSalvar: (input: { modo: 'padrao' | 'custom' | 'bes'; identificador?: string; digestBase64?: string; spuri?: string }) => Promise<ApiResult<{ modo: 'padrao' | 'custom' | 'bes'; identificador: string; digestBase64: string; spuri: string; padraoIdentificador: string; padraoDigestBase64: string; padraoSpuri: string }>>;
    politicaConfirmar: (input: { spuri: string; digestBase64: string }) => Promise<ApiResult<{ confere: boolean; calculado: string; spuriUsado: string }>>;
  };
  cloud: {
    status: () => Promise<ApiResult<{ url: string; key: string; enabled: boolean }>>;
    salvar: (input: { url: string; key: string; enabled: boolean }) => Promise<ApiResult<true>>;
    sync: () => Promise<ApiResult<{ synced: number }>>;
  };
  dados: {
    /** Notificação main → renderer: tabelas sincronizadas mudaram (outra máquina). */
    onAtualizados: (cb: (tabelas: string[]) => void) => () => void;
  };
  conexao: {
    /** Estado da sincronização em tempo real (online/offline/conectando). */
    onEstado: (cb: (estado: 'conectando' | 'online' | 'offline') => void) => () => void;
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
  DiplomaRow,
  HistoricoDisciplina,
  HistoricoDisciplinaInput,
  Docente,
  DocenteInput,
  Disciplina,
  DisciplinaInput,
  AlunoDocumento,
  CursoLivreRow,
  CursoLivreInput,
  AtaColacaoConcluinte,
  AtaColacaoDados,
};
