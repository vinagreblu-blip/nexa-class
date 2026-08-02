import type { IpcMainInvokeEvent} from 'electron';
import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { IPC_CHANNELS } from '../types';
import type { ApiResult } from '../types';
import { requerAuth } from './auth';
import { getPdfjs as loadPdfjs } from '../pdfjs-loader';
import { escapeXml, extrairJPEGsDoPDF } from '../utils';

// === PDF → XML ===
async function pdfParaXml(_event: IpcMainInvokeEvent): Promise<ApiResult<{ caminho: string }>> {
  const win = BrowserWindow.fromWebContents(_event.sender);
  if (!win) return { ok: false, error: 'Janela não disponível' };

  const openRes = await dialog.showOpenDialog(win, {
    title: 'Selecionar PDF',
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (openRes.canceled || !openRes.filePaths[0]) return { ok: false, error: 'Operação cancelada' };

  const pdfPath = openRes.filePaths[0];
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  let textoCompleto = '';

  // Tenta texto normal
  try {
    const pdf = await pdfjs.getDocument({ data, disableFontFace: true, useSystemFonts: false }).promise;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const linhas: Map<number, { x: number; text: string }[]> = new Map();
      for (const item of content.items as any[]) {
        const y = Math.round(item.transform[5]);
        const key = Math.round(y / 3) * 3;
        if (!linhas.has(key)) linhas.set(key, []);
        linhas.get(key)!.push({ x: item.transform[4], text: item.str });
      }
      const ys = Array.from(linhas.keys()).sort((a, b) => b - a);
      for (const y of ys) {
        const t = linhas.get(y)!.sort((a, b) => a.x - b.x).map((i) => i.text).join('').trim();
        if (t) textoCompleto += t + '\n';
      }
    }
  } catch { /* ignora */ }

  // Se não achou texto suficiente, usa OCR nas imagens JPEG embutidas
  if (textoCompleto.trim().length < 20) {
    textoCompleto = '';
    const buf = fs.readFileSync(pdfPath);
    const jpegImages = extrairJPEGsDoPDF(buf);
    if (jpegImages.length > 0) {
      const Tesseract = require('tesseract.js');
      jpegImages.sort((a, b) => b.length - a.length);
      const tempDir = path.join(require('os').tmpdir(), 'nexa-converter');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      for (const jpeg of jpegImages.slice(0, 3)) {
        const tempImg = path.join(tempDir, `img_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
        fs.writeFileSync(tempImg, jpeg);
        try {
          const result = await Tesseract.recognize(tempImg, 'por', { logger: () => {} });
          textoCompleto += result.data.text + '\n';
        } catch { /* ignora */ }
        try { fs.unlinkSync(tempImg); } catch { /* ignora */ }
      }
    }
  }

  if (textoCompleto.trim().length < 10) {
    return { ok: false, error: 'Não foi possível extrair texto do PDF.' };
  }

  const xml = gerarXmlDeTexto(textoCompleto, path.basename(pdfPath));

  const saveRes = await dialog.showSaveDialog(win, {
    title: 'Salvar XML',
    defaultPath: path.basename(pdfPath, '.pdf') + '.xml',
    filters: [{ name: 'XML', extensions: ['xml'] }],
  });
  if (saveRes.canceled || !saveRes.filePath) return { ok: false, error: 'Operação cancelada' };

  fs.writeFileSync(saveRes.filePath, xml, 'utf8');
  return { ok: true, data: { caminho: saveRes.filePath } };
}

// === IMG/PNG → XML ===
async function imgParaXml(_event: IpcMainInvokeEvent): Promise<ApiResult<{ caminho: string }>> {
  const win = BrowserWindow.fromWebContents(_event.sender);
  if (!win) return { ok: false, error: 'Janela não disponível' };

  const openRes = await dialog.showOpenDialog(win, {
    title: 'Selecionar Imagem',
    properties: ['openFile'],
    filters: [{ name: 'Imagens', extensions: ['jpg', 'jpeg', 'png'] }],
  });
  if (openRes.canceled || !openRes.filePaths[0]) return { ok: false, error: 'Operação cancelada' };

  const imgPath = openRes.filePaths[0];
  const Tesseract = require('tesseract.js');
  const result = await Tesseract.recognize(imgPath, 'por', { logger: () => {} });
  const texto = result.data.text;

  if (texto.trim().length < 10) {
    return { ok: false, error: 'Não foi possível extrair texto da imagem.' };
  }

  const xml = gerarXmlDeTexto(texto, path.basename(imgPath));

  const saveRes = await dialog.showSaveDialog(win, {
    title: 'Salvar XML',
    defaultPath: path.basename(imgPath, path.extname(imgPath)) + '.xml',
    filters: [{ name: 'XML', extensions: ['xml'] }],
  });
  if (saveRes.canceled || !saveRes.filePath) return { ok: false, error: 'Operação cancelada' };

  fs.writeFileSync(saveRes.filePath, xml, 'utf8');
  return { ok: true, data: { caminho: saveRes.filePath } };
}

// === XML → PDF ===
async function xmlParaPdf(_event: IpcMainInvokeEvent): Promise<ApiResult<{ caminho: string }>> {
  const win = BrowserWindow.fromWebContents(_event.sender);
  if (!win) return { ok: false, error: 'Janela não disponível' };

  const openRes = await dialog.showOpenDialog(win, {
    title: 'Selecionar XML',
    properties: ['openFile'],
    filters: [{ name: 'XML', extensions: ['xml'] }],
  });
  if (openRes.canceled || !openRes.filePaths[0]) return { ok: false, error: 'Operação cancelada' };

  const xmlPath = openRes.filePaths[0];
  const xmlContent = fs.readFileSync(xmlPath, 'utf8');

  const saveRes = await dialog.showSaveDialog(win, {
    title: 'Salvar PDF',
    defaultPath: path.basename(xmlPath, '.xml') + '.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (saveRes.canceled || !saveRes.filePath) return { ok: false, error: 'Operação cancelada' };

  gerarPdfDeXml(xmlContent, saveRes.filePath);
  return { ok: true, data: { caminho: saveRes.filePath } };
}

// === Helpers ===

function gerarXmlDeTexto(texto: string, origem: string): string {
  const linhas = texto.split('\n').filter((l) => l.trim());
  const e = escapeXml;
  let conteudoLinhas = '';
  for (let i = 0; i < linhas.length; i++) {
    conteudoLinhas += `    <linha numero="${i + 1}">${e(linhas[i].trim())}</linha>\n`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<documento xmlns="https://nexa-class.edu/conversao">
  <cabecalho>
    <sistema>NEXA CLASS</sistema>
    <geradoEm>${new Date().toISOString()}</geradoEm>
    <arquivoOrigem>${e(origem)}</arquivoOrigem>
    <totalLinhas>${linhas.length}</totalLinhas>
  </cabecalho>
  <conteudo>
${conteudoLinhas}  </conteudo>
</documento>
`;
}

function gerarPdfDeXml(xmlContent: string, destinoPath: string): void {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const stream = fs.createWriteStream(destinoPath);
  doc.pipe(stream);

  // Extrai texto do XML
  const linhas: { numero: string; texto: string }[] = [];
  const linhaMatches = [...xmlContent.matchAll(/<linha\s+numero="(\d+)"[^>]*>([\s\S]*?)<\/linha>/gi)];
  for (const m of linhaMatches) {
    linhas.push({ numero: m[1], texto: m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim() });
  }

  // Se não tem tags <linha>, pega texto entre <conteudo> e </conteudo>
  if (linhas.length === 0) {
    const conteudoMatch = xmlContent.match(/<conteudo[^>]*>([\s\S]*?)<\/conteudo>/i);
    if (conteudoMatch) {
      const textoRaw = conteudoMatch[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
      const separadas = textoRaw.split('\n').filter((l) => l.trim());
      separadas.forEach((l, i) => linhas.push({ numero: String(i + 1), texto: l.trim() }));
    }
  }

  // Cabeçalho
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#000000').text('Documento Convertido', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(10).font('Helvetica').fillColor('#666666').text(`Gerado em ${new Date().toLocaleString('pt-BR')} • NEXA CLASS`, { align: 'center' });
  doc.moveDown(1);
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).lineWidth(0.5).strokeColor('#cccccc').stroke();
  doc.moveDown(1);

  // Conteúdo
  doc.fontSize(10).font('Helvetica').fillColor('#000000');
  for (const linha of linhas) {
    if (doc.y > doc.page.height - 80) doc.addPage();
    doc.text(linha.texto, { lineGap: 4 });
  }

  doc.end();
}

export function registrarConversoesHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CONVERSAO_PDF_XML, requerAuth(pdfParaXml));
  ipcMain.handle(IPC_CHANNELS.CONVERSAO_IMG_XML, requerAuth(imgParaXml));
  ipcMain.handle(IPC_CHANNELS.CONVERSAO_XML_PDF, requerAuth(xmlParaPdf));
}
