import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './types';
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
  DiplomaRow,
  HistoricoDisciplina,
  HistoricoDisciplinaInput,
  Usuario,
  UsuarioInput,
  UsuarioPublico,
} from './types';

const api = {
  auth: {
    login: (username: string, password: string): Promise<ApiResult<UsuarioPublico>> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGIN, username, password),
    logout: (): Promise<ApiResult<true>> => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT),
    sessao: (): Promise<ApiResult<UsuarioPublico | null>> => ipcRenderer.invoke(IPC_CHANNELS.AUTH_SESSAO),
    alterarSenha: (atual: string, nova: string): Promise<ApiResult<true>> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_ALTERAR_SENHA, atual, nova),
    solicitarRecuperacao: (email: string): Promise<ApiResult<{ enviado: boolean }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_SOLICITAR_RECUPERACAO, email),
    redefinirComToken: (input: {
      email: string;
      codigo: string;
      novaSenha: string;
    }): Promise<ApiResult<true>> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_REDEFINIR_COM_TOKEN, input),
    dashboard: {
      obter: (): Promise<ApiResult<unknown>> =>
        ipcRenderer.invoke(IPC_CHANNELS.DASHBOARD_OBTER),
      revogar: (machineId: string): Promise<ApiResult<true>> =>
        ipcRenderer.invoke(IPC_CHANNELS.DASHBOARD_REVOGAR, machineId),
    },
  },
  smtp: {
    obter: (): Promise<ApiResult<{ provedor: string; email: string; senha: string } | null>> =>
      ipcRenderer.invoke(IPC_CHANNELS.SMTP_OBTER),
    salvar: (config: { provedor: string; email: string; senha: string }): Promise<ApiResult<{ provedor: string; email: string; senha: string }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.SMTP_SALVAR, config),
  },
  alunos: {
    listar: (busca?: string, origem?: string): Promise<ApiResult<Aluno[]>> =>
      ipcRenderer.invoke(IPC_CHANNELS.ALUNO_LISTAR, busca, origem),
    buscar: (id: number): Promise<ApiResult<Aluno>> =>
      ipcRenderer.invoke(IPC_CHANNELS.ALUNO_BUSCAR, id),
    criar: (input: AlunoInput): Promise<ApiResult<Aluno>> =>
      ipcRenderer.invoke(IPC_CHANNELS.ALUNO_CRIAR, input),
    atualizar: (id: number, input: AlunoInput): Promise<ApiResult<Aluno>> =>
      ipcRenderer.invoke(IPC_CHANNELS.ALUNO_ATUALIZAR, id, input),
    excluir: (id: number): Promise<ApiResult<true>> =>
      ipcRenderer.invoke(IPC_CHANNELS.ALUNO_EXCLUIR, id),
  },
  usuarios: {
    listar: (): Promise<ApiResult<Usuario[]>> => ipcRenderer.invoke(IPC_CHANNELS.USUARIO_LISTAR),
    criar: (input: UsuarioInput): Promise<ApiResult<Usuario>> =>
      ipcRenderer.invoke(IPC_CHANNELS.USUARIO_CRIAR, input),
    atualizar: (
      id: number,
      input: { username: string; nome: string; role: 'admin' | 'operador'; password?: string; ativo?: boolean }
    ): Promise<ApiResult<Usuario>> => ipcRenderer.invoke(IPC_CHANNELS.USUARIO_ATUALIZAR, id, input),
    excluir: (id: number): Promise<ApiResult<true>> =>
      ipcRenderer.invoke(IPC_CHANNELS.USUARIO_EXCLUIR, id),
    trocarFoto: (id: number): Promise<ApiResult<Usuario>> =>
      ipcRenderer.invoke(IPC_CHANNELS.USUARIO_TROCAR_FOTO, id),
    foto: (id: number): Promise<ApiResult<{ dataUrl: string | null }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.USUARIO_FOTO, id),
    resetarSenha: (id: number, masterPassword: string): Promise<ApiResult<{ senhaTemporaria: string }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.USUARIO_RESETAR_SENHA, id, masterPassword),
  },
  declaracoes: {
    emitir: (
      alunoId: number,
      semAssinatura = false,
      tipo?: 'generico' | 'historico' | 'diploma',
      diplomaId?: number
    ): Promise<ApiResult<DeclaracaoEmitida>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DECLARACAO_EMITIR, alunoId, semAssinatura, tipo, diplomaId),
    listar: (alunoId?: number): Promise<ApiResult<DeclaracaoRow[]>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DECLARACAO_LISTAR, alunoId),
    excluir: (id: number, senha: string): Promise<ApiResult<{ webOk: boolean }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DECLARACAO_EXCLUIR, id, senha),
    baixar: (id: number): Promise<ApiResult<{ salvoPath: string }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DECLARACAO_BAIXAR, id),
  },
  diplomas: {
    emitir: (alunoId: number, semAssinatura = false): Promise<ApiResult<any>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DIPLOMA_EMITIR, alunoId, semAssinatura),
    listar: (alunoId?: number): Promise<ApiResult<DiplomaRow[]>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DIPLOMA_LISTAR, alunoId),
    excluir: (id: number, senha: string): Promise<ApiResult<any>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DIPLOMA_EXCLUIR, id, senha),
    baixar: (id: number): Promise<ApiResult<{ salvoPath: string }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DIPLOMA_BAIXAR, id),
  },
  ataColacao: {
    listarConcluintes: (busca?: string): Promise<ApiResult<any[]>> =>
      ipcRenderer.invoke(IPC_CHANNELS.ATA_COLACAO_LISTAR_CONCLUINTES, busca),
    obter: (alunoId: number): Promise<ApiResult<any>> =>
      ipcRenderer.invoke(IPC_CHANNELS.ATA_COLACAO_OBTER, alunoId),
    salvar: (dados: any): Promise<ApiResult<any>> =>
      ipcRenderer.invoke(IPC_CHANNELS.ATA_COLACAO_SALVAR, dados),
    gerarPdf: (alunoId: number): Promise<ApiResult<{ pdfPath: string }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.ATA_COLACAO_GERAR_PDF, alunoId),
  },
  cursosLivres: {
    verificar: (senha: string): Promise<ApiResult<true>> =>
      ipcRenderer.invoke(IPC_CHANNELS.CURSO_LIVRE_VERIFICAR, senha),
    listar: (busca?: string): Promise<ApiResult<any[]>> =>
      ipcRenderer.invoke(IPC_CHANNELS.CURSO_LIVRE_LISTAR, busca),
    criar: (input: any): Promise<ApiResult<any>> =>
      ipcRenderer.invoke(IPC_CHANNELS.CURSO_LIVRE_CRIAR, input),
    atualizar: (id: number, input: any): Promise<ApiResult<any>> =>
      ipcRenderer.invoke(IPC_CHANNELS.CURSO_LIVRE_ATUALIZAR, id, input),
    excluir: (id: number): Promise<ApiResult<any>> =>
      ipcRenderer.invoke(IPC_CHANNELS.CURSO_LIVRE_EXCLUIR, id),
    listarAlunos: (cursoLivreId: number): Promise<ApiResult<any[]>> =>
      ipcRenderer.invoke(IPC_CHANNELS.CURSO_LIVRE_LISTAR_ALUNOS, cursoLivreId),
    vincularAluno: (cursoLivreId: number, alunoId: number): Promise<ApiResult<any>> =>
      ipcRenderer.invoke(IPC_CHANNELS.CURSO_LIVRE_VINCULAR_ALUNO, cursoLivreId, alunoId),
    desvincularAluno: (vinculoId: number): Promise<ApiResult<any>> =>
      ipcRenderer.invoke(IPC_CHANNELS.CURSO_LIVRE_DESVINCULAR_ALUNO, vinculoId),
  },
  historico: {
    listar: (alunoId: number): Promise<ApiResult<HistoricoDisciplina[]>> =>
      ipcRenderer.invoke(IPC_CHANNELS.HISTORICO_LISTAR, alunoId),
    criar: (alunoId: number, input: HistoricoDisciplinaInput): Promise<ApiResult<HistoricoDisciplina>> =>
      ipcRenderer.invoke(IPC_CHANNELS.HISTORICO_CRIAR, alunoId, input),
    atualizar: (id: number, input: HistoricoDisciplinaInput): Promise<ApiResult<HistoricoDisciplina>> =>
      ipcRenderer.invoke(IPC_CHANNELS.HISTORICO_ATUALIZAR, id, input),
    excluir: (id: number): Promise<ApiResult<true>> =>
      ipcRenderer.invoke(IPC_CHANNELS.HISTORICO_EXCLUIR, id),
    gerarPdf: (alunoId: number, semAssinatura = false): Promise<ApiResult<{ pdfPath: string; enviadoWeb: boolean }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.HISTORICO_GERAR_PDF, alunoId, semAssinatura),
    gerarXml: (alunoId: number): Promise<ApiResult<{ xmlPath: string }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.HISTORICO_GERAR_XML, alunoId),
    mover: (id: number, direcao: 'up' | 'down'): Promise<ApiResult<true>> =>
      ipcRenderer.invoke(IPC_CHANNELS.HISTORICO_MOVER, id, direcao),
  },
  docentes: {
    listar: (busca?: string): Promise<ApiResult<Docente[]>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DOCENTE_LISTAR, busca),
    criar: (input: DocenteInput): Promise<ApiResult<Docente>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DOCENTE_CRIAR, input),
    atualizar: (id: number, input: DocenteInput, senha: string): Promise<ApiResult<Docente>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DOCENTE_ATUALIZAR, id, input, senha),
    excluir: (id: number, senha: string): Promise<ApiResult<true>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DOCENTE_EXCLUIR, id, senha),
  },
  disciplinas: {
    listar: (busca?: string): Promise<ApiResult<Disciplina[]>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DISCIPLINA_LISTAR, busca),
    criar: (input: DisciplinaInput): Promise<ApiResult<Disciplina>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DISCIPLINA_CRIAR, input),
    atualizar: (id: number, input: DisciplinaInput, senha: string): Promise<ApiResult<Disciplina>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DISCIPLINA_ATUALIZAR, id, input, senha),
    excluir: (id: number, senha: string): Promise<ApiResult<true>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DISCIPLINA_EXCLUIR, id, senha),
  },
  documentos: {
    listar: (alunoId: number): Promise<ApiResult<AlunoDocumento[]>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DOCUMENTO_LISTAR, alunoId),
    adicionar: (alunoId: number): Promise<ApiResult<AlunoDocumento[]>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DOCUMENTO_ADICIONAR, alunoId),
    excluir: (id: number): Promise<ApiResult<true>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DOCUMENTO_EXCLUIR, id),
    converterXml: (id: number): Promise<ApiResult<{ xmlPath: string }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DOCUMENTO_CONVERTER_XML, id),
    visualizarXml: (id: number): Promise<ApiResult<{ nome: string; conteudo: string }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DOCUMENTO_VISUALIZAR_XML, id),
    baixar: (id: number, tipo: 'xml' | 'pdf'): Promise<ApiResult<{ salvoPath: string }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.DOCUMENTO_BAIXAR, id, tipo),
  },
  extracao: {
    extrairDadosDocumento: (): Promise<ApiResult<{
      nome: string | null; cpf: string | null; rg: string | null;
      orgaoEmissor: string | null;
      naturalidade: string | null; nacionalidade: string | null;
      dataNascimento: string | null; sexo: string | null;
    }>> => ipcRenderer.invoke(IPC_CHANNELS.EXTRAIR_DADOS_DOC),
  },
  conversoes: {
    pdfParaXml: (): Promise<ApiResult<{ caminho: string }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.CONVERSAO_PDF_XML),
    imgParaXml: (): Promise<ApiResult<{ caminho: string }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.CONVERSAO_IMG_XML),
    xmlParaPdf: (): Promise<ApiResult<{ caminho: string }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.CONVERSAO_XML_PDF),
  },
  assinatura: {
    obter: (): Promise<ApiResult<{ id: number; nome_signatario: string; cargo: string; imagem_path: string | null; certificado_path: string | null; certificado_tipo: 'A1' | 'A3' | null; certificado_a3_thumbprint: string | null; ativo: number } | null>> =>
      ipcRenderer.invoke(IPC_CHANNELS.ASSINATURA_OBTER),
    salvar: (input: { nome_signatario: string; cargo: string }): Promise<ApiResult<{ id: number; nome_signatario: string; cargo: string; imagem_path: string | null; certificado_path: string | null; certificado_tipo: 'A1' | 'A3' | null; certificado_a3_thumbprint: string | null; ativo: number }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.ASSINATURA_SALVAR, input),
    uploadCert: (tipo?: string): Promise<ApiResult<{ id: number; nome_signatario: string; cargo: string; imagem_path: string | null; certificado_path: string | null; certificado_tipo: 'A1' | 'A3' | null; certificado_a3_thumbprint: string | null; ativo: number }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.ASSINATURA_UPLOAD_CERT, tipo),
    listarCertsA3: (): Promise<ApiResult<{ thumbprint: string; subject: string; issuer: string; notBefore: string; notAfter: string; hasPrivateKey: boolean }[]>> =>
      ipcRenderer.invoke(IPC_CHANNELS.ASSINATURA_LISTAR_CERTS_A3),
    salvarCertA3: (thumbprint: string): Promise<ApiResult<{ id: number; nome_signatario: string; cargo: string; imagem_path: string | null; certificado_path: string | null; certificado_tipo: 'A1' | 'A3' | null; certificado_a3_thumbprint: string | null; ativo: number }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.ASSINATURA_SALVAR_CERT_A3, thumbprint),
    assinarXml: (xmlContent: string, senhaPfx: string): Promise<ApiResult<{ xml: string }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.ASSINATURA_ASSINAR_XML, xmlContent, senhaPfx),
    previewImagem: (): Promise<ApiResult<{ dataUrl: string | null }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.ASSINATURA_PREVIEW_IMAGEM),
  },
  cloud: {
    status: (): Promise<ApiResult<{ url: string; key: string; enabled: boolean }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.CLOUD_STATUS),
    salvar: (input: { url: string; key: string; enabled: boolean }): Promise<ApiResult<true>> =>
      ipcRenderer.invoke(IPC_CHANNELS.CLOUD_SALVAR, input),
    sync: (): Promise<ApiResult<{ synced: number }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.CLOUD_SYNC),
  },
};

contextBridge.exposeInMainWorld('api', api);

export type DesktopApi = typeof api;
