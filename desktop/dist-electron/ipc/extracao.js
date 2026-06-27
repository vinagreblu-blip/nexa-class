"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrarExtracaoHandlers = registrarExtracaoHandlers;
const electron_1 = require("electron");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const types_1 = require("../types");
const auth_1 = require("./auth");
const estados = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);
function capitalizar(nome) {
    const pequenas = ['de', 'da', 'do', 'das', 'dos', 'e'];
    return nome.trim().split(/\s+/).map((p) => {
        const l = p.toLowerCase();
        if (pequenas.includes(l))
            return l;
        return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
    }).join(' ');
}
// Corrige erros comuns de OCR (letras confundidas com números)
// Correção agressiva de OCR para campos numéricos (RG, CPF)
function corrigirOCRNumerico(s) {
    return s
        .replace(/[OoDQ]/g, '0')
        .replace(/[Iil|]/g, '1')
        .replace(/[Zz]/g, '2')
        .replace(/[Ee]/g, '3')
        .replace(/[Aa]/g, '4')
        .replace(/[Ss]/g, '5')
        .replace(/[G]/g, '6')
        .replace(/[Tt]/g, '7')
        .replace(/[Bb]/g, '8')
        .replace(/[Pg]/g, '9')
        .replace(/[Vv]/g, '0');
}
function corrigirOCR(s) {
    return s
        .replace(/[Oo](?=\d)/g, '0') // O antes de número → 0
        .replace(/(?<=\d)[Oo]/g, '0') // O depois de número → 0
        .replace(/l(?=\d)/g, '1') // l antes de número → 1
        .replace(/(?<=\d)l/g, '1') // l depois de número → 1
        .replace(/I(?=\d)/g, '1') // I antes de número → 1
        .replace(/(?<=\d)I/g, '1') // I depois de número → 1
        .replace(/S(?=\d{2})/g, '5') // S antes de 2 dígitos → 5
        .replace(/[Bb](?=\d)/g, '8') // B antes de número → 8
        .replace(/Z/g, '2'); // Z → 2
}
function parseTexto(textoOriginal) {
    const r = {
        nome: null, cpf: null, rg: null, orgaoEmissor: null,
        naturalidade: null, nacionalidade: null, dataNascimento: null, sexo: null,
    };
    // === NOME ===
    const linhas = textoOriginal.split('\n');
    for (let i = 0; i < linhas.length; i++) {
        const l = linhas[i].trim();
        if (/^NOME\s*[:]*$/i.test(l)) {
            for (let j = i + 1; j < Math.min(i + 4, linhas.length); j++) {
                const candidato = linhas[j].trim().replace(/['"]/g, '').replace(/\s{2,}/g, ' ');
                if (candidato.length >= 5 && !/\d/.test(candidato) &&
                    candidato.split(/\s+/).length >= 2 && candidato.split(/\s+/).length <= 8 &&
                    !/CPF|RG|DOC|DATA|NASC|SEX|FILIA|NACION|NATURAL|CARTEIRA|PERMISS/i.test(candidato)) {
                    r.nome = capitalizar(candidato);
                    break;
                }
            }
            if (r.nome)
                break;
        }
        // "NOME <nome>" na mesma linha
        const m = l.match(/^NOME\s+(.{5,60})$/i);
        if (m && m[1] && !/\d/.test(m[1]) && m[1].split(/\s+/).length >= 2) {
            r.nome = capitalizar(m[1].trim());
            break;
        }
    }
    // === DATA DE NASCIMENTO ===
    // Procura por "DATA NASCIMENTO" seguido de data na mesma ou próxima linha
    const dataPat1 = /DATA\s*NASCIMENTO\s*(\d{2})[/.](\d{2})[/.](\d{2,4})/i;
    const dataPat2 = /DATA\s*DE\s*NASCIMENTO\s*(\d{2})[/.](\d{2})[/.]((\d{2,4}))/i;
    const dataPat3 = /NASCIMENTO\s*[:\n]?\s*(\d{2})[/.](\d{2})[/.](\d{2,4})/i;
    let dataM = textoOriginal.match(dataPat1) || textoOriginal.match(dataPat2) || textoOriginal.match(dataPat3);
    // Fallback: procura data DD/MM/AAAA próxima do CPF
    if (!dataM) {
        const todasDatas = [...textoOriginal.matchAll(/\b(\d{2})[/.](\d{2})[/.](\d{4})\b/g)];
        for (const d of todasDatas) {
            const dia = +d[1], mes = +d[2], ano = +d[3];
            if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 1940 && ano <= 2020) {
                dataM = d;
                break;
            }
        }
    }
    if (dataM) {
        let dia = dataM[1], mes = dataM[2], ano = dataM[3];
        if (ano.length === 2)
            ano = parseInt(ano) > 30 ? '19' + ano : '20' + ano;
        if (+dia >= 1 && +dia <= 31 && +mes >= 1 && +mes <= 12) {
            r.dataNascimento = `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
        }
    }
    // === CPF ===
    // Corrige OCR na região do CPF, depois procura
    // Procura por "CPF" label, pega o que vem depois
    const cpfRegiaoIdx = textoOriginal.search(/CPF/i);
    if (cpfRegiaoIdx >= 0) {
        const aposCPF = textoOriginal.substring(cpfRegiaoIdx, cpfRegiaoIdx + 60);
        const corrigido = corrigirOCR(aposCPF);
        const cpfM = corrigido.match(/(\d{3})\.?\s*(\d{3})\.?\s*(\d{3})-?\s*(\d{2})/);
        if (cpfM) {
            const d = cpfM[1] + cpfM[2] + cpfM[3] + cpfM[4];
            if (d.length === 11 && !/^(\d)\1{10}$/.test(d)) {
                r.cpf = `${d.substring(0, 3)}.${d.substring(3, 6)}.${d.substring(6, 9)}-${d.substring(9, 11)}`;
            }
        }
    }
    // Fallback: procura qualquer padrão de CPF no texto corrigido
    if (!r.cpf) {
        const corrigido = corrigirOCR(textoOriginal);
        const cpfM = corrigido.match(/(\d{3})\.(\d{3})\.(\d{3})-(\d{2})/) ||
            corrigido.match(/\b(\d{3})(\d{3})(\d{3})(\d{2})\b/);
        if (cpfM) {
            const d = cpfM[1] + (cpfM[2] || '') + (cpfM[3] || '') + (cpfM[4] || '');
            if (d.length === 11 && !/^(\d)\1{10}$/.test(d)) {
                r.cpf = `${d.substring(0, 3)}.${d.substring(3, 6)}.${d.substring(6, 9)}-${d.substring(9, 11)}`;
            }
        }
    }
    // === RG + Órgão Emissor ===
    // Procura por "DOC. IDENTIDADE" ou "IDENTIDADE/ÓRG EMISSOR/UF"
    const rgRegiaoIdx = textoOriginal.search(/DOC\.?\s*IDENTIDADE|IDENTIDADE\s*\/\s*ORG/i);
    if (rgRegiaoIdx >= 0) {
        // Pega as próximas 2 linhas após o label
        const aposLabel = textoOriginal.substring(rgRegiaoIdx);
        const linhasApos = aposLabel.split('\n').filter(l => l.trim());
        // Procura órgão emissor (texto conhecido) na região
        const orgMatch = aposLabel.substring(0, 100).match(/(SSP|DIC|DETRAN|PC|IFP|SJSP|SSP\/[A-Z]{2})/i);
        if (orgMatch)
            r.orgaoEmissor = orgMatch[1].toUpperCase();
        // Pega a primeira linha de dados após o label (onde está o RG)
        for (let li = 1; li < Math.min(4, linhasApos.length); li++) {
            const linhaDados = linhasApos[li].trim();
            // Ignora linhas que são labels (CPF, DATA, etc)
            if (/CPF|DATA|NASC|FILIA|NACION/i.test(linhaDados))
                continue;
            // Estratégia 1: regex padrão após correção leve
            const corrigidoLeve = corrigirOCR(linhaDados);
            const rgLeve = corrigidoLeve.match(/(\d{2}\.?\d{3}\.?\d{3}-?\d?)/);
            if (rgLeve && rgLeve[1].replace(/\D/g, '').length >= 5) {
                r.rg = rgLeve[1].trim();
                break;
            }
            // Estratégia 2: correção agressiva — extrai só os dígitos
            // Remove órgão emissor e UF conhecidos da linha primeiro
            let linhaLimpa = linhaDados
                .replace(/SSP|DIC|DETRAN|PC\b|IFP|SJSP/i, '')
                .replace(/\b[A-Z]{2}\s*$/, '');
            // Aplica correção agressiva de OCR numérico
            const soNums = corrigirOCRNumerico(linhaLimpa);
            // Extrai sequência de dígitos
            const digitos = soNums.match(/\d{7,12}/);
            if (digitos) {
                const d = digitos[0];
                // Formata como RG: 00.000.000-0
                if (d.length >= 8 && d.length <= 12) {
                    if (d.length === 9) {
                        r.rg = `${d.substring(0, 2)}.${d.substring(2, 5)}.${d.substring(5, 8)}-${d.substring(8)}`;
                    }
                    else if (d.length === 10) {
                        r.rg = `${d.substring(0, 2)}.${d.substring(2, 5)}.${d.substring(5, 8)}-${d.substring(8, 9)}`;
                    }
                    else {
                        r.rg = d;
                    }
                    break;
                }
            }
        }
        // Tenta extrair UF (naturalidade) da mesma região
        if (!r.naturalidade) {
            const ufM = aposLabel.substring(0, 120).match(/\b([A-Z]{2})\s*$/m);
            if (ufM && estados.has(ufM[1].toUpperCase()))
                r.naturalidade = ufM[1].toUpperCase();
            // OCR pode ter lido errado — tenta "Ru" → "BA", "RJ" etc.
            const ufCorrigir = aposLabel.substring(0, 120).match(/(?:SSP|DIC|DETRAN)\s*\/?\s*([A-Za-z]{2})\b/i);
            if (ufCorrigir) {
                const uf = ufCorrigir[1].toUpperCase();
                if (estados.has(uf))
                    r.naturalidade = uf;
            }
        }
    }
    // Fallback RG: busca em todo o texto
    if (!r.rg) {
        const corrigido = corrigirOCR(textoOriginal);
        const rgM = corrigido.match(/(?:RG|IDENTIDADE)[:\s]*(\d{2}\.?\d{3}\.?\d{3}-?\d?)/i);
        if (rgM && rgM[1].replace(/\D/g, '').length >= 5)
            r.rg = rgM[1].trim();
    }
    // === Nacionalidade ===
    if (/BRASILEIR[AO]/i.test(textoOriginal))
        r.nacionalidade = 'Brasileiro(a)';
    // === Sexo ===
    const sexoM = textoOriginal.match(/SEXO\s*[:\n]?\s*(MASC|FEM)/i);
    if (sexoM)
        r.sexo = /F/i.test(sexoM[1]) ? 'Feminino' : 'Masculino';
    // === Naturalidade ===
    if (!r.naturalidade) {
        const natM = textoOriginal.match(/(?:NATURALIDADE|UF)\s*[:\n]?\s*([A-Z]{2})\b/i);
        if (natM && estados.has(natM[1].toUpperCase()))
            r.naturalidade = natM[1].toUpperCase();
    }
    return r;
}
// Extrai imagens JPEG de um PDF procurando pelos marcadores JPEG nos bytes
function extrairJPEGsDoPDF(buf) {
    const imagens = [];
    const SOI = Buffer.from([0xFF, 0xD8]); // JPEG Start of Image
    const EOI = Buffer.from([0xFF, 0xD9]); // JPEG End of Image
    let pos = 0;
    while (pos < buf.length - 1) {
        // Procura SOI
        const soiIdx = buf.indexOf(SOI, pos);
        if (soiIdx === -1)
            break;
        // Procura EOI a partir do SOI
        const eoiIdx = buf.indexOf(EOI, soiIdx + 2);
        if (eoiIdx === -1)
            break;
        // Extrai o JPEG completo
        const jpeg = buf.subarray(soiIdx, eoiIdx + 2);
        // Só guarda se for razoavelmente grande (> 5KB = provavelmente a foto, não ícone)
        if (jpeg.length > 5000) {
            imagens.push(Buffer.from(jpeg));
        }
        pos = eoiIdx + 2;
    }
    return imagens;
}
async function extrairDadosDocumento(event) {
    const win = electron_1.BrowserWindow.fromWebContents(event.sender);
    if (!win)
        return { ok: false, error: 'Janela não disponível' };
    const res = await electron_1.dialog.showOpenDialog(win, {
        title: 'Selecionar RG ou CNH (PDF, JPG ou PNG)',
        properties: ['openFile'],
        filters: [
            { name: 'Documentos e Imagens', extensions: ['pdf', 'jpg', 'jpeg', 'png'] },
        ],
    });
    if (res.canceled || res.filePaths.length === 0) {
        return { ok: false, error: 'Nenhum arquivo selecionado' };
    }
    const filePath = res.filePaths[0];
    const ext = filePath.toLowerCase().split('.').pop();
    let textoCompleto = '';
    if (ext === 'pdf') {
        const buf = node_fs_1.default.readFileSync(filePath);
        // 1. Tenta texto com pdfjs
        try {
            const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
            const data = new Uint8Array(buf);
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
        // 2. Se não achou CPF/NOME no texto, usa OCR nas imagens JPEG embutidas
        if (!textoCompleto.match(/\d{3}\.\d{3}\.\d{3}/) && !textoCompleto.match(/NOME/i)) {
            textoCompleto = '';
            const jpegImages = extrairJPEGsDoPDF(buf);
            if (jpegImages.length === 0) {
                return { ok: false, error: 'Não foi possível extrair texto nem imagens do PDF.' };
            }
            // Roda OCR na maior imagem (geralmente é a foto do documento)
            const Tesseract = require('tesseract.js');
            const tempDir = node_path_1.default.join(electron_1.app.getPath('temp'), 'nexa-ocr');
            if (!node_fs_1.default.existsSync(tempDir))
                node_fs_1.default.mkdirSync(tempDir, { recursive: true });
            //Ordena por tamanho (maior primeiro = documento principal)
            jpegImages.sort((a, b) => b.length - a.length);
            for (const jpeg of jpegImages.slice(0, 3)) { // no máximo 3 maiores
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
    else {
        // Imagem direta (JPG/PNG): OCR
        const Tesseract = require('tesseract.js');
        const result = await Tesseract.recognize(filePath, 'por', { logger: () => { } });
        textoCompleto = result.data.text;
    }
    if (textoCompleto.trim().length < 10) {
        return { ok: false, error: 'Não foi possível extrair texto do documento.' };
    }
    const resultado = parseTexto(textoCompleto);
    return { ok: true, data: resultado };
}
function registrarExtracaoHandlers() {
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.EXTRAIR_DADOS_DOC, (0, auth_1.requerAuth)(extrairDadosDocumento));
}
//# sourceMappingURL=extracao.js.map