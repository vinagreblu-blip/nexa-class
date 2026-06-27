"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const types_1 = require("./types");
const api = {
    auth: {
        login: (username, password) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.AUTH_LOGIN, username, password),
        logout: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.AUTH_LOGOUT),
        sessao: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.AUTH_SESSAO),
        alterarSenha: (atual, nova) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.AUTH_ALTERAR_SENHA, atual, nova),
        solicitarRecuperacao: (email) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.AUTH_SOLICITAR_RECUPERACAO, email),
    },
    smtp: {
        obter: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.SMTP_OBTER),
        salvar: (config) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.SMTP_SALVAR, config),
    },
    alunos: {
        listar: (busca) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.ALUNO_LISTAR, busca),
        buscar: (id) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.ALUNO_BUSCAR, id),
        criar: (input) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.ALUNO_CRIAR, input),
        atualizar: (id, input) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.ALUNO_ATUALIZAR, id, input),
        excluir: (id) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.ALUNO_EXCLUIR, id),
    },
    usuarios: {
        listar: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.USUARIO_LISTAR),
        criar: (input) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.USUARIO_CRIAR, input),
        atualizar: (id, input) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.USUARIO_ATUALIZAR, id, input),
        excluir: (id) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.USUARIO_EXCLUIR, id),
        trocarFoto: (id) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.USUARIO_TROCAR_FOTO, id),
        foto: (id) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.USUARIO_FOTO, id),
        resetarSenha: (id, masterPassword) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.USUARIO_RESETAR_SENHA, id, masterPassword),
    },
    declaracoes: {
        emitir: (alunoId) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DECLARACAO_EMITIR, alunoId),
        listar: (alunoId) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DECLARACAO_LISTAR, alunoId),
        excluir: (id, senha) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DECLARACAO_EXCLUIR, id, senha),
        baixar: (id) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DECLARACAO_BAIXAR, id),
    },
    historico: {
        listar: (alunoId) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.HISTORICO_LISTAR, alunoId),
        criar: (alunoId, input) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.HISTORICO_CRIAR, alunoId, input),
        atualizar: (id, input) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.HISTORICO_ATUALIZAR, id, input),
        excluir: (id) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.HISTORICO_EXCLUIR, id),
        gerarPdf: (alunoId) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.HISTORICO_GERAR_PDF, alunoId),
        gerarXml: (alunoId) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.HISTORICO_GERAR_XML, alunoId),
        mover: (id, direcao) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.HISTORICO_MOVER, id, direcao),
    },
    docentes: {
        listar: (busca) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DOCENTE_LISTAR, busca),
        criar: (input) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DOCENTE_CRIAR, input),
        atualizar: (id, input, senha) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DOCENTE_ATUALIZAR, id, input, senha),
        excluir: (id, senha) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DOCENTE_EXCLUIR, id, senha),
    },
    disciplinas: {
        listar: (busca) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DISCIPLINA_LISTAR, busca),
        criar: (input) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DISCIPLINA_CRIAR, input),
        atualizar: (id, input, senha) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DISCIPLINA_ATUALIZAR, id, input, senha),
        excluir: (id, senha) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DISCIPLINA_EXCLUIR, id, senha),
    },
    documentos: {
        listar: (alunoId) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DOCUMENTO_LISTAR, alunoId),
        adicionar: (alunoId) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DOCUMENTO_ADICIONAR, alunoId),
        excluir: (id) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DOCUMENTO_EXCLUIR, id),
        converterXml: (id) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DOCUMENTO_CONVERTER_XML, id),
        visualizarXml: (id) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DOCUMENTO_VISUALIZAR_XML, id),
        baixar: (id, tipo) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DOCUMENTO_BAIXAR, id, tipo),
    },
    extracao: {
        extrairDadosDocumento: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.EXTRAIR_DADOS_DOC),
    },
    conversoes: {
        pdfParaXml: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.CONVERSAO_PDF_XML),
        imgParaXml: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.CONVERSAO_IMG_XML),
        xmlParaPdf: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.CONVERSAO_XML_PDF),
    },
    assinatura: {
        obter: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.ASSINATURA_OBTER),
        salvar: (input) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.ASSINATURA_SALVAR, input),
        uploadCert: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.ASSINATURA_UPLOAD_CERT),
        assinarXml: (xmlContent, senhaPfx) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.ASSINATURA_ASSINAR_XML, xmlContent, senhaPfx),
    },
};
electron_1.contextBridge.exposeInMainWorld('api', api);
//# sourceMappingURL=preload.js.map