"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrarDeclaracaoHandlers = registrarDeclaracaoHandlers;
const electron_1 = require("electron");
const node_crypto_1 = require("node:crypto");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const qrcode_1 = __importDefault(require("qrcode"));
const pdfkit_1 = __importDefault(require("pdfkit"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const database_1 = require("../database");
const config_1 = require("../config");
const faculdades_1 = require("../faculdades");
const types_1 = require("../types");
const auth_1 = require("./auth");
const assinatura_1 = require("./assinatura");
const qr_validador_1 = require("../qr-validador");
function gerarHashConteudo(aluno, emitidoEm) {
    const payload = [
        aluno.id,
        aluno.matricula,
        aluno.nome,
        aluno.cpf ?? '',
        aluno.curso ?? '',
        emitidoEm,
    ].join('|');
    return (0, node_crypto_1.createHash)('sha256').update(payload, 'utf8').digest('hex');
}
async function registrarNoWeb(codigo, hash, aluno, emitidoEm) {
    try {
        const url = `${config_1.CONFIG.VERIFICACAO_BASE_URL.replace(/\/$/, '')}/api/declaracoes`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config_1.CONFIG.VERIFICACAO_API_KEY,
            },
            body: JSON.stringify({
                codigo_verificacao: codigo,
                hash_conteudo: hash,
                dados_aluno: {
                    nome: aluno.nome,
                    matricula: aluno.matricula,
                    curso: aluno.curso ?? null,
                    cpf: aluno.cpf ?? null,
                },
                emitido_em: emitidoEm,
            }),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!resp.ok) {
            const texto = await resp.text().catch(() => '');
            return { ok: false, error: `Serviço web retornou ${resp.status}: ${texto}` };
        }
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: e?.message ?? 'Falha ao contatar o serviço de verificação' };
    }
}
async function gerarQrPng(url) {
    return qrcode_1.default.toBuffer(url, {
        type: 'png',
        margin: 1,
        width: 240,
        color: { dark: '#000000', light: '#ffffff' },
    });
}
function gerarPdf(opts) {
    const { aluno, codigo, hash, qrBuffer, emitidoEm, destinoPath, cursoTexto, cargaHorariaTotal, faculdadeNome, diretor, faculdade } = opts;
    const doc = new pdfkit_1.default({ size: 'A4', margin: 60 });
    const stream = node_fs_1.default.createWriteStream(destinoPath);
    doc.pipe(stream);
    const largura = doc.page.width;
    const dateFmt = new Date(emitidoEm).toLocaleString('pt-BR', { timeZone: 'UTC' });
    // ===== CABEÇALHO DA FACULDADE (com logo) =====
    const logoExiste = faculdade.logoPath && node_fs_1.default.existsSync(faculdade.logoPath);
    if (logoExiste) {
        const logoW = 70;
        const gap = 8;
        try {
            doc.image(faculdade.logoPath, 60, 60, { width: logoW });
        }
        catch { /* ignora */ }
        const textoX = 60 + logoW + gap;
        const textoWidth = largura - 60 - textoX;
        doc.fillColor('#000000');
        doc.font('Helvetica-Bold').fontSize(13);
        doc.text(faculdade.nome, textoX, 60, { width: textoWidth, align: 'left' });
        let yy = doc.y + 1;
        doc.font('Helvetica').fontSize(8);
        if (faculdade.cnpj) {
            doc.text(`CNPJ ${faculdade.cnpj}${faculdade.email ? ' / E-mail.: ' + faculdade.email : ''}${faculdade.telefone ? ' ' + faculdade.telefone : ''}`, textoX, yy, { width: textoWidth });
            yy = doc.y;
        }
        if (faculdade.endereco) {
            doc.text(`ENDEREÇO: ${faculdade.endereco}`, textoX, yy, { width: textoWidth });
            yy = doc.y;
        }
        doc.y = Math.max(yy, 60 + logoW);
    }
    else {
        doc.fillColor('#000000');
        doc.font('Helvetica-Bold').fontSize(16);
        doc.text(faculdade.nome, 60, 60, { width: largura - 120, align: 'center' });
        let yy = doc.y + 1;
        doc.font('Helvetica').fontSize(8);
        if (faculdade.cnpj) {
            doc.text(`CNPJ ${faculdade.cnpj}${faculdade.email ? ' / E-mail.: ' + faculdade.email : ''}${faculdade.telefone ? ' ' + faculdade.telefone : ''}`, 60, yy, { width: largura - 120, align: 'center' });
            yy = doc.y;
        }
        if (faculdade.endereco) {
            doc.text(`ENDEREÇO: ${faculdade.endereco}`, 60, yy, { width: largura - 120, align: 'center' });
            yy = doc.y;
        }
        doc.y = yy + 10;
    }
    // Linha separadora
    doc.y += 4;
    doc.moveTo(60, doc.y).lineTo(largura - 60, doc.y).lineWidth(1).strokeColor('#000000').stroke();
    doc.y += 10;
    doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .fillColor('#000000')
        .text('Declaração de Autenticidade', { align: 'center' });
    doc.moveDown(1.2);
    doc
        .fillColor('#000000')
        .fontSize(11)
        .font('Helvetica')
        .text('Declaramos, para os devidos fins, que o documento referente ao(a) aluno(a) abaixo identificado(a) é autêntico e foi emitido por este sistema, podendo ter sua autenticidade verificada por meio do código de verificação ou do QR Code impresso neste documento.', { align: 'justify', lineGap: 4 });
    doc.moveDown(1.2);
    const linhaY = doc.y;
    doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#666666')
        .text('NOME', 60, linhaY);
    doc
        .font('Helvetica')
        .fillColor('#000000')
        .fontSize(12)
        .text(aluno.nome, 60, linhaY + 14);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#666666').text('MATRÍCULA', 300, linhaY);
    doc
        .font('Helvetica')
        .fillColor('#000000')
        .fontSize(12)
        .text(aluno.matricula, 300, linhaY + 14);
    doc.moveDown(2.2);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#666666').text('CURSO', 60);
    doc
        .font('Helvetica')
        .fillColor('#000000')
        .fontSize(12)
        .text(`GRADUAÇÃO EM ${cursoTexto}`, 60, doc.y + 4);
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#666666').text('CARGA HORÁRIA TOTAL', 60);
    doc
        .font('Helvetica')
        .fillColor('#000000')
        .fontSize(12)
        .text(`${cargaHorariaTotal.toLocaleString('pt-BR')} horas/aula`, 60, doc.y + 4);
    doc.moveDown(1);
    if (aluno.cpf) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#666666').text('CPF', 60);
        doc.font('Helvetica').fillColor('#000000').fontSize(12).text(aluno.cpf, 60, doc.y + 4);
        doc.moveDown(1.5);
    }
    // Texto de autenticidade
    doc
        .fillColor('#000000')
        .fontSize(10)
        .font('Helvetica')
        .text(`O certificado e o histórico escolar apresentados foram emitidos com base nos registros acadêmicos oficiais da ${faculdadeNome}, refletindo informações verídicas sobre a trajetória acadêmica do aluno, incluindo disciplinas cursadas, cargas horárias, notas obtidas e data de conclusão do curso.`, { align: 'justify', lineGap: 3 });
    doc.moveDown(0.6);
    doc.text('Este documento é autêntico e válido, emitido em conformidade com as normas educacionais vigentes e com os atos legais de autorização e reconhecimento do curso registrados junto ao Ministério da Educação (MEC).', { align: 'justify', lineGap: 3 });
    doc.moveDown(0.6);
    // Assinatura digital (imagem) se cadastrada
    const assinatura = (0, assinatura_1.getAssinaturaAtiva)();
    const nomeAss = assinatura?.nome_signatario || diretor;
    const cargoAss = assinatura?.cargo || 'Diretor Geral';
    const assImgExiste = assinatura?.imagem_path && node_fs_1.default.existsSync(assinatura.imagem_path);
    doc.moveDown(1);
    const centro = largura / 2;
    if (assImgExiste) {
        try {
            doc.image(assinatura.imagem_path, centro - 90, doc.y, { width: 180 });
            doc.moveDown(2.5);
        }
        catch { /* ignora */ }
    }
    doc.moveTo(centro - 130, doc.y).lineTo(centro + 130, doc.y).lineWidth(0.7).strokeColor('#000000').stroke();
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000').text(nomeAss, centro - 130, doc.y + 3, { width: 260, align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor('#444444').text(cargoAss, centro - 130, doc.y, { width: 260, align: 'center' });
    doc.moveDown(2);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#666666').text('DATA DE EMISSÃO', 60);
    doc.font('Helvetica').fillColor('#000000').fontSize(12).text(dateFmt, 60, doc.y + 4);
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#666666').text('CÓDIGO DE VERIFICAÇÃO', 60);
    doc.font('Courier').fillColor('#000000').fontSize(11).text(codigo, 60, doc.y + 4);
    const qrX = largura - 60 - 110;
    const qrY = doc.y - 30;
    doc.image(qrBuffer, qrX, qrY, { width: 110, height: 110 });
    doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#666666')
        .text('Escaneie para verificar', qrX, qrY + 114, { width: 110, align: 'center' });
    doc.moveDown(4);
    doc
        .moveTo(60, doc.y)
        .lineTo(largura - 60, doc.y)
        .strokeColor('#cccccc')
        .lineWidth(0.5)
        .stroke();
    doc.moveDown(0.5);
    doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#888888')
        .text(`Hash de integridade: ${hash}`, 60, doc.y, { align: 'left' })
        .fontSize(7)
        .text(`Escaneie o QR Code para validar este documento em qualquer dispositivo.`, { align: 'left' });
    doc.end();
}
async function emitir(event, alunoId) {
    const sessao = (0, auth_1.getSessao)();
    if (!sessao)
        return { ok: false, error: 'Não autenticado' };
    const db = (0, database_1.getDb)();
    const aluno = db.prepare('SELECT * FROM alunos WHERE id = ?').get(alunoId);
    if (!aluno)
        return { ok: false, error: 'Aluno não encontrado' };
    const codigo = (0, node_crypto_1.randomUUID)();
    const agora = new Date().toISOString();
    const hash = gerarHashConteudo(aluno, agora);
    let info;
    try {
        info = db
            .prepare(`INSERT INTO declaracoes (aluno_id, codigo_verificacao, hash_conteudo, emitido_por)
         VALUES (?, ?, ?, ?)`)
            .run(aluno.id, codigo, hash, sessao.usuario.id);
    }
    catch (e) {
        return { ok: false, error: e?.message ?? 'Erro ao registrar declaração' };
    }
    const declaracao = db
        .prepare('SELECT * FROM declaracoes WHERE id = ?')
        .get(info.lastInsertRowid);
    const webResult = await registrarNoWeb(codigo, hash, aluno, agora);
    if (webResult.ok) {
        db.prepare('UPDATE declaracoes SET enviado_web = 1 WHERE id = ?').run(declaracao.id);
        declaracao.enviado_web = 1;
    }
    else {
        console.warn('[declaracao] Falha ao enviar para web:', webResult.error);
    }
    const win = electron_1.BrowserWindow.fromWebContents(event.sender);
    const nomeArquivo = `declaracao-${aluno.matricula}-${declaracao.id}.pdf`;
    // Salva uma cópia interna em userData/declaracoes/ (para re-download posterior)
    const declaracoesDir = node_path_1.default.join(electron_1.app.getPath('userData'), 'declaracoes');
    if (!node_fs_1.default.existsSync(declaracoesDir))
        node_fs_1.default.mkdirSync(declaracoesDir, { recursive: true });
    const caminhoInterno = node_path_1.default.join(declaracoesDir, `${declaracao.id}.pdf`);
    // Também oferece salvar onde o usuário quiser
    const destino = win != null
        ? await electron_1.dialog.showSaveDialog(win, {
            title: 'Salvar Declaração',
            defaultPath: nomeArquivo,
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
        })
        : { canceled: true, filePath: '' };
    if (destino.canceled || !destino.filePath) {
        return { ok: false, error: 'Operação cancelada pelo usuário' };
    }
    ;
    const urlVerificacao = (0, qr_validador_1.gerarUrlValidacao)({
        n: aluno.nome,
        m: aluno.matricula || String(aluno.id),
        c: aluno.curso || undefined,
        f: aluno.faculdade || undefined,
        t: 'Declaração de Autenticidade',
        e: agora,
        k: codigo,
    });
    const qrBuffer = await gerarQrPng(urlVerificacao);
    // dados complementares para o texto da declaração
    const fac = (0, faculdades_1.getFaculdadeInfo)(aluno.faculdade);
    const cursoInfo = aluno.curso && fac.cursos[aluno.curso] ? fac.cursos[aluno.curso] : null;
    const cursoTexto = (cursoInfo?.nome || aluno.curso || '').toUpperCase();
    const diretor = fac.diretor || '—';
    const faculdadeNome = fac.nome || aluno.faculdade || '—';
    const discRows = db
        .prepare('SELECT ch FROM historico_disciplinas WHERE aluno_id = ?')
        .all(aluno.id);
    const cargaHorariaTotal = discRows.reduce((s, d) => {
        const n = parseInt((d.ch ?? '').replace(/\D/g, '') || '0', 10);
        return s + (isNaN(n) ? 0 : n);
    }, 0);
    gerarPdf({
        aluno,
        codigo,
        hash,
        qrBuffer,
        emitidoEm: agora,
        destinoPath: destino.filePath,
        cursoTexto,
        cargaHorariaTotal,
        faculdadeNome,
        diretor,
        faculdade: fac,
    });
    // Salva cópia interna para re-download
    try {
        node_fs_1.default.copyFileSync(destino.filePath, caminhoInterno);
        db.prepare('UPDATE declaracoes SET pdf_caminho = ? WHERE id = ?').run(caminhoInterno, declaracao.id);
    }
    catch { /* ignora se falhar */ }
    return {
        ok: true,
        data: {
            declaracao,
            pdfPath: destino.filePath,
            enviadoWeb: webResult.ok,
        },
    };
}
function listar(_event, alunoId) {
    const db = (0, database_1.getDb)();
    const rows = alunoId != null
        ? db
            .prepare(`SELECT d.*, a.nome AS aluno_nome, a.matricula AS aluno_matricula,
                    u.nome AS emitido_por_nome, u.codigo AS emitido_por_codigo
             FROM declaracoes d
             JOIN alunos a ON a.id = d.aluno_id
             JOIN usuarios u ON u.id = d.emitido_por
             WHERE d.aluno_id = ?
             ORDER BY d.emitido_em DESC`)
            .all(alunoId)
        : db
            .prepare(`SELECT d.*, a.nome AS aluno_nome, a.matricula AS aluno_matricula,
                    u.nome AS emitido_por_nome, u.codigo AS emitido_por_codigo
             FROM declaracoes d
             JOIN alunos a ON a.id = d.aluno_id
             JOIN usuarios u ON u.id = d.emitido_por
             ORDER BY d.emitido_em DESC`)
            .all();
    return { ok: true, data: rows };
}
async function removerDoWeb(codigo) {
    try {
        const url = `${config_1.CONFIG.VERIFICACAO_BASE_URL.replace(/\/$/, '')}/api/declaracoes/${encodeURIComponent(codigo)}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const resp = await fetch(url, {
            method: 'DELETE',
            headers: { 'x-api-key': config_1.CONFIG.VERIFICACAO_API_KEY },
            signal: controller.signal,
        });
        clearTimeout(timeout);
        return resp.ok;
    }
    catch {
        return false;
    }
}
async function excluir(_event, id, senha) {
    const sessao = (0, auth_1.getSessao)();
    if (!sessao)
        return { ok: false, error: 'Não autenticado' };
    if (sessao.usuario.username !== 'admin') {
        return { ok: false, error: 'Apenas o administrador (admin) pode excluir declarações' };
    }
    if (!bcryptjs_1.default.compareSync(senha ?? '', config_1.CONFIG.SENHA_EXCLUSAO_DECLARACAO_HASH)) {
        return { ok: false, error: 'Senha de exclusão incorreta' };
    }
    const db = (0, database_1.getDb)();
    const decl = db
        .prepare('SELECT codigo_verificacao FROM declaracoes WHERE id = ?')
        .get(id);
    if (!decl)
        return { ok: false, error: 'Declaração não encontrada' };
    db.prepare('DELETE FROM declaracoes WHERE id = ?').run(id);
    const webOk = await removerDoWeb(decl.codigo_verificacao);
    return { ok: true, data: { webOk } };
}
async function baixar(event, id) {
    const db = (0, database_1.getDb)();
    const decl = db.prepare('SELECT * FROM declaracoes WHERE id = ?').get(id);
    if (!decl)
        return { ok: false, error: 'Declaração não encontrada' };
    const win = electron_1.BrowserWindow.fromWebContents(event.sender);
    if (!win)
        return { ok: false, error: 'Janela não disponível' };
    // Tenta o caminho salvo, senão o padrão em userData
    let pdfPath = decl.pdf_caminho || '';
    if (!pdfPath || !node_fs_1.default.existsSync(pdfPath)) {
        pdfPath = node_path_1.default.join(electron_1.app.getPath('userData'), 'declaracoes', `${id}.pdf`);
    }
    if (!node_fs_1.default.existsSync(pdfPath)) {
        return { ok: false, error: 'Arquivo PDF da declaração não encontrado. Re-genere a declaração.' };
    }
    const aluno = db.prepare('SELECT nome, matricula FROM alunos WHERE id = ?').get(decl.aluno_id);
    const nomeSugerido = `declaracao-${aluno?.matricula || id}.pdf`;
    const res = await electron_1.dialog.showSaveDialog(win, {
        title: 'Salvar Cópia da Declaração',
        defaultPath: nomeSugerido,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath)
        return { ok: false, error: 'Operação cancelada' };
    node_fs_1.default.copyFileSync(pdfPath, res.filePath);
    return { ok: true, data: { salvoPath: res.filePath } };
}
function registrarDeclaracaoHandlers() {
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DECLARACAO_EMITIR, (0, auth_1.requerAuth)(emitir));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DECLARACAO_LISTAR, (0, auth_1.requerAuth)(listar));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DECLARACAO_EXCLUIR, (0, auth_1.requerAuth)(excluir));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DECLARACAO_BAIXAR, (0, auth_1.requerAuth)(baixar));
}
//# sourceMappingURL=declaracao.js.map