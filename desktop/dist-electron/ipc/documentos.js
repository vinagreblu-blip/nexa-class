"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrarDocumentosHandlers = registrarDocumentosHandlers;
const electron_1 = require("electron");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const database_1 = require("../database");
const types_1 = require("../types");
const auth_1 = require("./auth");
// Carrega pdfjs-dist (legacy build, compatível com Node) sob demanda
let pdfjsLib;
function getPdfjs() {
    if (!pdfjsLib) {
        pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    }
    return pdfjsLib;
}
function getDocumentosDir(alunoId) {
    return node_path_1.default.join(electron_1.app.getPath('userData'), 'documentos', String(alunoId));
}
function garantirPasta(alunoId) {
    const dir = getDocumentosDir(alunoId);
    if (!node_fs_1.default.existsSync(dir))
        node_fs_1.default.mkdirSync(dir, { recursive: true });
    return dir;
}
function listar(_event, alunoId) {
    const db = (0, database_1.getDb)();
    const rows = db
        .prepare('SELECT * FROM aluno_documentos WHERE aluno_id = ? ORDER BY created_at DESC')
        .all(alunoId);
    return { ok: true, data: rows };
}
async function adicionar(event, alunoId) {
    const win = electron_1.BrowserWindow.fromWebContents(event.sender);
    if (!win)
        return { ok: false, error: 'Janela não disponível' };
    const res = await electron_1.dialog.showOpenDialog(win, {
        title: 'Selecionar PDFs',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || res.filePaths.length === 0) {
        return { ok: false, error: 'Nenhum arquivo selecionado' };
    }
    const dir = garantirPasta(alunoId);
    const db = (0, database_1.getDb)();
    const inseridos = [];
    for (const originalPath of res.filePaths) {
        const nomeOriginal = node_path_1.default.basename(originalPath);
        // evita sobrescrever: adiciona sufixo se já existir
        let destino = node_path_1.default.join(dir, nomeOriginal);
        if (node_fs_1.default.existsSync(destino)) {
            const ext = node_path_1.default.extname(nomeOriginal);
            const base = node_path_1.default.basename(nomeOriginal, ext);
            let i = 1;
            while (node_fs_1.default.existsSync(node_path_1.default.join(dir, `${base} (${i})${ext}`)))
                i++;
            destino = node_path_1.default.join(dir, `${base} (${i})${ext}`);
        }
        node_fs_1.default.copyFileSync(originalPath, destino);
        const info = db
            .prepare('INSERT INTO aluno_documentos (aluno_id, nome, caminho) VALUES (?, ?, ?)')
            .run(alunoId, node_path_1.default.basename(destino), destino);
        const row = db
            .prepare('SELECT * FROM aluno_documentos WHERE id = ?')
            .get(info.lastInsertRowid);
        inseridos.push(row);
    }
    return { ok: true, data: inseridos };
}
async function converterXml(_event, documentoId) {
    const db = (0, database_1.getDb)();
    const doc = db
        .prepare('SELECT * FROM aluno_documentos WHERE id = ?')
        .get(documentoId);
    if (!doc)
        return { ok: false, error: 'Documento não encontrado' };
    if (!node_fs_1.default.existsSync(doc.caminho))
        return { ok: false, error: 'Arquivo PDF não encontrado no disco' };
    // dados do aluno para o XML
    const aluno = db
        .prepare('SELECT * FROM alunos WHERE id = ?')
        .get(doc.aluno_id);
    // extrai texto do PDF
    const pdfjs = getPdfjs();
    const data = new Uint8Array(node_fs_1.default.readFileSync(doc.caminho));
    const pdf = await pdfjs.getDocument({
        data,
        disableFontFace: true,
        useSystemFonts: false,
    }).promise;
    let conteudo = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map((it) => it.str).join(' ').trim();
        conteudo += `  <pagina numero="${i}">${escapeXml(pageText)}</pagina>\n`;
    }
    const xml = buildXml({
        aluno: aluno ? { nome: aluno.nome, matricula: aluno.matricula, cpf: aluno.cpf ?? '', curso: aluno.curso ?? '', faculdade: aluno.faculdade ?? '' } : null,
        arquivo: doc.nome,
        totalPaginas: pdf.numPages,
        conteudo,
        geradoEm: new Date().toISOString(),
    });
    const xmlPath = node_path_1.default.join(node_path_1.default.dirname(doc.caminho), node_path_1.default.basename(doc.nome, '.pdf') + '.xml');
    node_fs_1.default.writeFileSync(xmlPath, xml, 'utf8');
    db.prepare('UPDATE aluno_documentos SET xml_path = ?, convertido = 1 WHERE id = ?').run(xmlPath, documentoId);
    return { ok: true, data: { xmlPath } };
}
function excluir(_event, documentoId) {
    const db = (0, database_1.getDb)();
    const doc = db
        .prepare('SELECT * FROM aluno_documentos WHERE id = ?')
        .get(documentoId);
    if (!doc)
        return { ok: false, error: 'Documento não encontrado' };
    // remove arquivos do disco (melhor esforço)
    try {
        if (doc.caminho && node_fs_1.default.existsSync(doc.caminho))
            node_fs_1.default.unlinkSync(doc.caminho);
    }
    catch {
        /* ignora */
    }
    try {
        if (doc.xml_path && node_fs_1.default.existsSync(doc.xml_path))
            node_fs_1.default.unlinkSync(doc.xml_path);
    }
    catch {
        /* ignora */
    }
    db.prepare('DELETE FROM aluno_documentos WHERE id = ?').run(documentoId);
    return { ok: true, data: true };
}
function escapeXml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
function buildXml(opts) {
    const { aluno, arquivo, totalPaginas, conteudo, geradoEm } = opts;
    const e = escapeXml;
    return `<?xml version="1.0" encoding="UTF-8"?>
<documento xmlns="https://nexa-class.edu/documento">
  <cabecalho>
    <sistema>NEXA CLASS</sistema>
    <geradoEm>${geradoEm}</geradoEm>
    <arquivoOrigem>${e(arquivo)}</arquivoOrigem>
    <totalPaginas>${totalPaginas}</totalPaginas>
  </cabecalho>
${aluno
        ? `  <aluno>
    <nome>${e(aluno.nome)}</nome>
    <matricula>${e(aluno.matricula)}</matricula>
    <cpf>${e(aluno.cpf)}</cpf>
    <curso>${e(aluno.curso)}</curso>
    <faculdade>${e(aluno.faculdade)}</faculdade>
  </aluno>`
        : '  <aluno />'}
  <conteudo totalPaginas="${totalPaginas}">
${conteudo}  </conteudo>
</documento>
`;
}
function visualizarXml(_event, documentoId) {
    const db = (0, database_1.getDb)();
    const doc = db
        .prepare('SELECT * FROM aluno_documentos WHERE id = ?')
        .get(documentoId);
    if (!doc)
        return { ok: false, error: 'Documento não encontrado' };
    if (doc.convertido !== 1 || !doc.xml_path) {
        return { ok: false, error: 'XML ainda não gerado para este documento' };
    }
    if (!node_fs_1.default.existsSync(doc.xml_path)) {
        return { ok: false, error: 'Arquivo XML não encontrado no disco' };
    }
    const conteudo = node_fs_1.default.readFileSync(doc.xml_path, 'utf8');
    return { ok: true, data: { nome: node_path_1.default.basename(doc.xml_path), conteudo } };
}
async function baixar(event, documentoId, tipo) {
    const db = (0, database_1.getDb)();
    const doc = db
        .prepare('SELECT * FROM aluno_documentos WHERE id = ?')
        .get(documentoId);
    if (!doc)
        return { ok: false, error: 'Documento não encontrado' };
    const origem = tipo === 'xml' ? doc.xml_path : doc.caminho;
    if (!origem)
        return { ok: false, error: 'Arquivo não disponível' };
    if (!node_fs_1.default.existsSync(origem))
        return { ok: false, error: 'Arquivo não encontrado no disco' };
    const win = electron_1.BrowserWindow.fromWebContents(event.sender);
    if (!win)
        return { ok: false, error: 'Janela não disponível' };
    const nomeBase = tipo === 'xml'
        ? node_path_1.default.basename(doc.nome, '.pdf') + '.xml'
        : doc.nome;
    const res = await electron_1.dialog.showSaveDialog(win, {
        title: tipo === 'xml' ? 'Salvar XML' : 'Salvar PDF',
        defaultPath: nomeBase,
        filters: [{ name: tipo === 'xml' ? 'XML' : 'PDF', extensions: [tipo] }],
    });
    if (res.canceled || !res.filePath) {
        return { ok: false, error: 'Operação cancelada' };
    }
    node_fs_1.default.copyFileSync(origem, res.filePath);
    return { ok: true, data: { salvoPath: res.filePath } };
}
function registrarDocumentosHandlers() {
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DOCUMENTO_LISTAR, (0, auth_1.requerAuth)(listar));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DOCUMENTO_ADICIONAR, (0, auth_1.requerAuth)(adicionar));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DOCUMENTO_EXCLUIR, (0, auth_1.requerAuth)(excluir));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DOCUMENTO_CONVERTER_XML, (0, auth_1.requerAuth)(converterXml));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DOCUMENTO_VISUALIZAR_XML, (0, auth_1.requerAuth)(visualizarXml));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DOCUMENTO_BAIXAR, (0, auth_1.requerAuth)(baixar));
}
void auth_1.getSessao;
//# sourceMappingURL=documentos.js.map