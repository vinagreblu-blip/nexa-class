"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrarConversoesHandlers = registrarConversoesHandlers;
const electron_1 = require("electron");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const pdfkit_1 = __importDefault(require("pdfkit"));
const types_1 = require("../types");
const auth_1 = require("./auth");
// === PDF → XML ===
async function pdfParaXml(_event) {
    const win = electron_1.BrowserWindow.fromWebContents(_event.sender);
    if (!win)
        return { ok: false, error: 'Janela não disponível' };
    const openRes = await electron_1.dialog.showOpenDialog(win, {
        title: 'Selecionar PDF',
        properties: ['openFile'],
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (openRes.canceled || !openRes.filePaths[0])
        return { ok: false, error: 'Operação cancelada' };
    const pdfPath = openRes.filePaths[0];
    const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
    const data = new Uint8Array(node_fs_1.default.readFileSync(pdfPath));
    let textoCompleto = '';
    // Tenta texto normal
    try {
        const pdf = await pdfjs.getDocument({ data, disableFontFace: true, useSystemFonts: false }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const linhas = new Map();
            for (const item of content.items) {
                const y = Math.round(item.transform[5]);
                const key = Math.round(y / 3) * 3;
                if (!linhas.has(key))
                    linhas.set(key, []);
                linhas.get(key).push({ x: item.transform[4], text: item.str });
            }
            const ys = Array.from(linhas.keys()).sort((a, b) => b - a);
            for (const y of ys) {
                const t = linhas.get(y).sort((a, b) => a.x - b.x).map((i) => i.text).join('').trim();
                if (t)
                    textoCompleto += t + '\n';
            }
        }
    }
    catch { /* ignora */ }
    // Se não achou texto suficiente, usa OCR nas imagens JPEG embutidas
    if (textoCompleto.trim().length < 20) {
        textoCompleto = '';
        const buf = node_fs_1.default.readFileSync(pdfPath);
        const jpegImages = extrairJPEGs(buf);
        if (jpegImages.length > 0) {
            const Tesseract = require('tesseract.js');
            jpegImages.sort((a, b) => b.length - a.length);
            const tempDir = node_path_1.default.join(require('os').tmpdir(), 'nexa-converter');
            if (!node_fs_1.default.existsSync(tempDir))
                node_fs_1.default.mkdirSync(tempDir, { recursive: true });
            for (const jpeg of jpegImages.slice(0, 3)) {
                const tempImg = node_path_1.default.join(tempDir, `img_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
                node_fs_1.default.writeFileSync(tempImg, jpeg);
                try {
                    const result = await Tesseract.recognize(tempImg, 'por', { logger: () => { } });
                    textoCompleto += result.data.text + '\n';
                }
                catch { /* ignora */ }
                try {
                    node_fs_1.default.unlinkSync(tempImg);
                }
                catch { /* ignora */ }
            }
        }
    }
    if (textoCompleto.trim().length < 10) {
        return { ok: false, error: 'Não foi possível extrair texto do PDF.' };
    }
    const xml = gerarXmlDeTexto(textoCompleto, node_path_1.default.basename(pdfPath));
    const saveRes = await electron_1.dialog.showSaveDialog(win, {
        title: 'Salvar XML',
        defaultPath: node_path_1.default.basename(pdfPath, '.pdf') + '.xml',
        filters: [{ name: 'XML', extensions: ['xml'] }],
    });
    if (saveRes.canceled || !saveRes.filePath)
        return { ok: false, error: 'Operação cancelada' };
    node_fs_1.default.writeFileSync(saveRes.filePath, xml, 'utf8');
    return { ok: true, data: { caminho: saveRes.filePath } };
}
// === IMG/PNG → XML ===
async function imgParaXml(_event) {
    const win = electron_1.BrowserWindow.fromWebContents(_event.sender);
    if (!win)
        return { ok: false, error: 'Janela não disponível' };
    const openRes = await electron_1.dialog.showOpenDialog(win, {
        title: 'Selecionar Imagem',
        properties: ['openFile'],
        filters: [{ name: 'Imagens', extensions: ['jpg', 'jpeg', 'png'] }],
    });
    if (openRes.canceled || !openRes.filePaths[0])
        return { ok: false, error: 'Operação cancelada' };
    const imgPath = openRes.filePaths[0];
    const Tesseract = require('tesseract.js');
    const result = await Tesseract.recognize(imgPath, 'por', { logger: () => { } });
    const texto = result.data.text;
    if (texto.trim().length < 10) {
        return { ok: false, error: 'Não foi possível extrair texto da imagem.' };
    }
    const xml = gerarXmlDeTexto(texto, node_path_1.default.basename(imgPath));
    const saveRes = await electron_1.dialog.showSaveDialog(win, {
        title: 'Salvar XML',
        defaultPath: node_path_1.default.basename(imgPath, node_path_1.default.extname(imgPath)) + '.xml',
        filters: [{ name: 'XML', extensions: ['xml'] }],
    });
    if (saveRes.canceled || !saveRes.filePath)
        return { ok: false, error: 'Operação cancelada' };
    node_fs_1.default.writeFileSync(saveRes.filePath, xml, 'utf8');
    return { ok: true, data: { caminho: saveRes.filePath } };
}
// === XML → PDF ===
async function xmlParaPdf(_event) {
    const win = electron_1.BrowserWindow.fromWebContents(_event.sender);
    if (!win)
        return { ok: false, error: 'Janela não disponível' };
    const openRes = await electron_1.dialog.showOpenDialog(win, {
        title: 'Selecionar XML',
        properties: ['openFile'],
        filters: [{ name: 'XML', extensions: ['xml'] }],
    });
    if (openRes.canceled || !openRes.filePaths[0])
        return { ok: false, error: 'Operação cancelada' };
    const xmlPath = openRes.filePaths[0];
    const xmlContent = node_fs_1.default.readFileSync(xmlPath, 'utf8');
    const saveRes = await electron_1.dialog.showSaveDialog(win, {
        title: 'Salvar PDF',
        defaultPath: node_path_1.default.basename(xmlPath, '.xml') + '.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (saveRes.canceled || !saveRes.filePath)
        return { ok: false, error: 'Operação cancelada' };
    gerarPdfDeXml(xmlContent, saveRes.filePath);
    return { ok: true, data: { caminho: saveRes.filePath } };
}
// === Helpers ===
function escapeXml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function gerarXmlDeTexto(texto, origem) {
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
function extrairJPEGs(buf) {
    const imagens = [];
    const SOI = Buffer.from([0xFF, 0xD8]);
    const EOI = Buffer.from([0xFF, 0xD9]);
    let pos = 0;
    while (pos < buf.length - 1) {
        const soi = buf.indexOf(SOI, pos);
        if (soi === -1)
            break;
        const eoi = buf.indexOf(EOI, soi + 2);
        if (eoi === -1)
            break;
        const jpeg = buf.subarray(soi, eoi + 2);
        if (jpeg.length > 5000)
            imagens.push(Buffer.from(jpeg));
        pos = eoi + 2;
    }
    return imagens;
}
function gerarPdfDeXml(xmlContent, destinoPath) {
    const doc = new pdfkit_1.default({ size: 'A4', margin: 50 });
    const stream = node_fs_1.default.createWriteStream(destinoPath);
    doc.pipe(stream);
    // Extrai texto do XML
    const linhas = [];
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
        if (doc.y > doc.page.height - 80)
            doc.addPage();
        doc.text(linha.texto, { lineGap: 4 });
    }
    doc.end();
}
function registrarConversoesHandlers() {
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.CONVERSAO_PDF_XML, (0, auth_1.requerAuth)(pdfParaXml));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.CONVERSAO_IMG_XML, (0, auth_1.requerAuth)(imgParaXml));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.CONVERSAO_XML_PDF, (0, auth_1.requerAuth)(xmlParaPdf));
}
//# sourceMappingURL=conversoes.js.map