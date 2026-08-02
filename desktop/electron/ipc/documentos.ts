import type { IpcMainInvokeEvent} from 'electron';
import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../database';
import { IPC_CHANNELS } from '../types';
import type { Aluno, AlunoDocumento, ApiResult } from '../types';
import { getSessao, requerAuth } from './auth';
import { getPdfjs as loadPdfjs } from '../pdfjs-loader';
import { escapeXml } from '../utils';

// (pdfjs carregado sob demanda via pdfjs-loader — v5+ ESM-only)

function getDocumentosDir(alunoId: number): string {
  return path.join(app.getPath('userData'), 'documentos', String(alunoId));
}

function garantirPasta(alunoId: number): string {
  const dir = getDocumentosDir(alunoId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listar(_event: IpcMainInvokeEvent, alunoId: number): ApiResult<AlunoDocumento[]> {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM aluno_documentos WHERE aluno_id = ? ORDER BY created_at DESC')
    .all(alunoId) as AlunoDocumento[];
  return { ok: true, data: rows };
}

async function adicionar(
  event: IpcMainInvokeEvent,
  alunoId: number
): Promise<ApiResult<AlunoDocumento[]>> {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, error: 'Janela não disponível' };

  const res = await dialog.showOpenDialog(win, {
    title: 'Selecionar PDFs',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled || res.filePaths.length === 0) {
    return { ok: false, error: 'Nenhum arquivo selecionado' };
  }

  const dir = garantirPasta(alunoId);
  const db = getDb();
  const inseridos: AlunoDocumento[] = [];

  for (const originalPath of res.filePaths) {
    const nomeOriginal = path.basename(originalPath);
    // evita sobrescrever: adiciona sufixo se já existir
    let destino = path.join(dir, nomeOriginal);
    if (fs.existsSync(destino)) {
      const ext = path.extname(nomeOriginal);
      const base = path.basename(nomeOriginal, ext);
      let i = 1;
      while (fs.existsSync(path.join(dir, `${base} (${i})${ext}`))) i++;
      destino = path.join(dir, `${base} (${i})${ext}`);
    }
    fs.copyFileSync(originalPath, destino);
    const info = db
      .prepare('INSERT INTO aluno_documentos (aluno_id, nome, caminho) VALUES (?, ?, ?)')
      .run(alunoId, path.basename(destino), destino);
    const row = db
      .prepare('SELECT * FROM aluno_documentos WHERE id = ?')
      .get(info.lastInsertRowid) as AlunoDocumento;
    inseridos.push(row);
  }

  return { ok: true, data: inseridos };
}

async function converterXml(
  _event: IpcMainInvokeEvent,
  documentoId: number
): Promise<ApiResult<{ xmlPath: string }>> {
  const db = getDb();
  const doc = db
    .prepare('SELECT * FROM aluno_documentos WHERE id = ?')
    .get(documentoId) as AlunoDocumento | undefined;
  if (!doc) return { ok: false, error: 'Documento não encontrado' };
  if (!fs.existsSync(doc.caminho)) return { ok: false, error: 'Arquivo PDF não encontrado no disco' };

  // dados do aluno para o XML
  const aluno = db
    .prepare('SELECT * FROM alunos WHERE id = ?')
    .get(doc.aluno_id) as Aluno | undefined;

  // extrai texto do PDF
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(fs.readFileSync(doc.caminho));
  const pdf = await pdfjs.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
  }).promise;

  let conteudo = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((it: any) => it.str).join(' ').trim();
    conteudo += `  <pagina numero="${i}">${escapeXml(pageText)}</pagina>\n`;
  }

  const xml = buildXml({
    aluno: aluno ? { nome: aluno.nome, matricula: aluno.matricula, cpf: aluno.cpf ?? '', curso: aluno.curso ?? '', faculdade: aluno.faculdade ?? '' } : null,
    arquivo: doc.nome,
    totalPaginas: pdf.numPages,
    conteudo,
    geradoEm: new Date().toISOString(),
  });

  const xmlPath = path.join(path.dirname(doc.caminho), path.basename(doc.nome, '.pdf') + '.xml');
  fs.writeFileSync(xmlPath, xml, 'utf8');

  db.prepare('UPDATE aluno_documentos SET xml_path = ?, convertido = 1 WHERE id = ?').run(
    xmlPath,
    documentoId
  );

  return { ok: true, data: { xmlPath } };
}

function excluir(_event: IpcMainInvokeEvent, documentoId: number): ApiResult<true> {
  const db = getDb();
  const doc = db
    .prepare('SELECT * FROM aluno_documentos WHERE id = ?')
    .get(documentoId) as AlunoDocumento | undefined;
  if (!doc) return { ok: false, error: 'Documento não encontrado' };
  // remove arquivos do disco (melhor esforço)
  try {
    if (doc.caminho && fs.existsSync(doc.caminho)) fs.unlinkSync(doc.caminho);
  } catch {
    /* ignora */
  }
  try {
    if (doc.xml_path && fs.existsSync(doc.xml_path)) fs.unlinkSync(doc.xml_path);
  } catch {
    /* ignora */
  }
  db.prepare('DELETE FROM aluno_documentos WHERE id = ?').run(documentoId);
  return { ok: true, data: true };
}

function buildXml(opts: {
  aluno: { nome: string; matricula: string; cpf: string; curso: string; faculdade: string } | null;
  arquivo: string;
  totalPaginas: number;
  conteudo: string;
  geradoEm: string;
}): string {
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
${
  aluno
    ? `  <aluno>
    <nome>${e(aluno.nome)}</nome>
    <matricula>${e(aluno.matricula)}</matricula>
    <cpf>${e(aluno.cpf)}</cpf>
    <curso>${e(aluno.curso)}</curso>
    <faculdade>${e(aluno.faculdade)}</faculdade>
  </aluno>`
    : '  <aluno />'
}
  <conteudo totalPaginas="${totalPaginas}">
${conteudo}  </conteudo>
</documento>
`;
}

function visualizarXml(
  _event: IpcMainInvokeEvent,
  documentoId: number
): ApiResult<{ nome: string; conteudo: string }> {
  const db = getDb();
  const doc = db
    .prepare('SELECT * FROM aluno_documentos WHERE id = ?')
    .get(documentoId) as AlunoDocumento | undefined;
  if (!doc) return { ok: false, error: 'Documento não encontrado' };
  if (doc.convertido !== 1 || !doc.xml_path) {
    return { ok: false, error: 'XML ainda não gerado para este documento' };
  }
  if (!fs.existsSync(doc.xml_path)) {
    return { ok: false, error: 'Arquivo XML não encontrado no disco' };
  }
  const conteudo = fs.readFileSync(doc.xml_path, 'utf8');
  return { ok: true, data: { nome: path.basename(doc.xml_path), conteudo } };
}

async function baixar(
  event: IpcMainInvokeEvent,
  documentoId: number,
  tipo: 'xml' | 'pdf'
): Promise<ApiResult<{ salvoPath: string }>> {
  const db = getDb();
  const doc = db
    .prepare('SELECT * FROM aluno_documentos WHERE id = ?')
    .get(documentoId) as AlunoDocumento | undefined;
  if (!doc) return { ok: false, error: 'Documento não encontrado' };

  const origem = tipo === 'xml' ? doc.xml_path : doc.caminho;
  if (!origem) return { ok: false, error: 'Arquivo não disponível' };
  if (!fs.existsSync(origem)) return { ok: false, error: 'Arquivo não encontrado no disco' };

  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, error: 'Janela não disponível' };

  const nomeBase =
    tipo === 'xml'
      ? path.basename(doc.nome, '.pdf') + '.xml'
      : doc.nome;
  const res = await dialog.showSaveDialog(win, {
    title: tipo === 'xml' ? 'Salvar XML' : 'Salvar PDF',
    defaultPath: nomeBase,
    filters: [{ name: tipo === 'xml' ? 'XML' : 'PDF', extensions: [tipo] }],
  });
  if (res.canceled || !res.filePath) {
    return { ok: false, error: 'Operação cancelada' };
  }
  fs.copyFileSync(origem, res.filePath);
  return { ok: true, data: { salvoPath: res.filePath } };
}

export function registrarDocumentosHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.DOCUMENTO_LISTAR, requerAuth(listar));
  ipcMain.handle(IPC_CHANNELS.DOCUMENTO_ADICIONAR, requerAuth(adicionar));
  ipcMain.handle(IPC_CHANNELS.DOCUMENTO_EXCLUIR, requerAuth(excluir));
  ipcMain.handle(IPC_CHANNELS.DOCUMENTO_CONVERTER_XML, requerAuth(converterXml));
  ipcMain.handle(IPC_CHANNELS.DOCUMENTO_VISUALIZAR_XML, requerAuth(visualizarXml));
  ipcMain.handle(IPC_CHANNELS.DOCUMENTO_BAIXAR, requerAuth(baixar));
}

void getSessao;
