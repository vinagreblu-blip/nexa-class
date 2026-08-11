import type { IpcMainInvokeEvent} from 'electron';
import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { getDb } from '../database';
import { CONFIG } from '../config';
import { getFaculdadeInfo } from '../faculdades';
import { IPC_CHANNELS } from '../types';
import type { Aluno, ApiResult } from '../types';
import { getSessao, requerAuth } from './auth';
import { getAssinaturaAtiva } from './assinatura';
import { assinarPdfSeConfigurado } from '../pades';
import { gerarUrlValidacao } from '../qr-validador';
import { validarSenhaMaster } from '../utils/regras';
import { montarNomePdf } from '../utils/sistema';
import { getImageSize, getPngContentBounds } from '../image-size';
import { gerarHashConteudo, gerarQrPng, formatarDataExtensoBrasilia } from '../utils';

interface DiplomaOpts {
  aluno: Aluno;
  codigo: string;
  hash: string;
  qrBuffer: Buffer;
  emitidoEm: string;
  destinoPath: string;
  cursoTexto: string;
  cargaHorariaTotal: number;
  faculdadeNome: string;
  diretor: string;
  faculdade: ReturnType<typeof getFaculdadeInfo>;
  semAssinatura?: boolean;
}

function gerarPdf(opts: DiplomaOpts): Promise<void> {
  const { aluno, codigo, hash, qrBuffer, emitidoEm, destinoPath, cursoTexto, cargaHorariaTotal, faculdadeNome, diretor, faculdade, semAssinatura } = opts;

  const doc = new PDFDocument({ size: 'A4', margin: 60 });
  const stream = fs.createWriteStream(destinoPath);
  stream.on('error', () => {});
  doc.pipe(stream);

  const largura = doc.page.width;
  const dateFmt = formatarDataExtensoBrasilia(emitidoEm);

  // ===== CABEÇALHO =====
  const logoExiste = faculdade.logoPath && fs.existsSync(faculdade.logoPath);
  if (logoExiste) {
    const logoW = 70;
    const gap = 8;
    try {
      doc.image(faculdade.logoPath!, 60, 50, { width: logoW });
    } catch { /* ignora */ }
    const textoX = 60 + logoW + gap;
    const textoWidth = largura - 60 - textoX;
    doc.fillColor('#000000');
    doc.font('Helvetica-Bold').fontSize(13);
    doc.text(faculdade.nome, textoX, 50, { width: textoWidth, align: 'left' });
    let yy = doc.y + 1;
    doc.font('Helvetica').fontSize(8);
    if (faculdade.cnpj) {
      doc.text(`CNPJ ${faculdade.cnpj}`, textoX, yy, { width: textoWidth });
      yy = doc.y;
    }
    if (faculdade.endereco) {
      doc.text(`ENDEREÇO: ${faculdade.endereco}`, textoX, yy, { width: textoWidth });
      yy = doc.y;
    }
    doc.y = Math.max(yy, 50 + logoW);
  } else {
    doc.fillColor('#000000');
    doc.font('Helvetica-Bold').fontSize(16);
    doc.text(faculdade.nome, 60, 50, { width: largura - 120, align: 'center' });
    doc.y += 10;
  }

  // Linha separadora
  doc.y += 6;
  doc.moveTo(60, doc.y).lineTo(largura - 60, doc.y).lineWidth(1).strokeColor('#000000').stroke();
  doc.y += 20;

  // ===== TÍTULO =====
  doc.font('Helvetica-Bold').fontSize(26).fillColor('#000000');
  doc.text('DIPLOMA', { align: 'center' });
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(11).fillColor('#444444');
  doc.text('de conclusão de curso de graduação', { align: 'center' });
  doc.moveDown(1.5);

  // ===== TEXTO PRINCIPAL =====
  doc.fillColor('#000000').fontSize(12).font('Helvetica');
  doc.text(
    `O Diretor da ${faculdadeNome}, no uso de suas atribuições legais, confere o presente diploma de`,
    { align: 'center', lineGap: 3 }
  );

  // Nome do aluno em destaque
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#000000');
  doc.text(aluno.nome, { align: 'center' });
  doc.moveDown(0.3);

  // Dados do curso
  doc.font('Helvetica').fontSize(12).fillColor('#000000');
  doc.text(
    `concluiu o curso de ${cursoTexto}, com carga horária total de ${cargaHorariaTotal.toLocaleString('pt-BR')} horas/aula,` +
    ` tendo cumprido todos os requisitos acadêmicos necessários para a obtenção do título.`,
    { align: 'justify', lineGap: 3 }
  );

  doc.moveDown(0.6);
  doc.text(
    `Em reconhecimento ao mérito e à dedicação demonstrados ao longo do curso, outorgamos-lhe o presente diploma ` +
    `para gozo de todos os direitos e prerrogativas a ele inerentes.`,
    { align: 'justify', lineGap: 3 }
  );

  // ===== DADOS DO ALUNO =====
  doc.moveDown(1.5);
  const dadosY = doc.y;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#666666');
  doc.text('MATRÍCULA', 60, dadosY);
  doc.font('Helvetica').fontSize(11).fillColor('#000000');
  doc.text(aluno.matricula, 60, dadosY + 13);

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#666666');
  doc.text('CPF', 250, dadosY);
  doc.font('Helvetica').fontSize(11).fillColor('#000000');
  doc.text(aluno.cpf || '—', 250, dadosY + 13);

  if (aluno.data_nascimento) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#666666');
    doc.text('NASCIMENTO', 380, dadosY);
    doc.font('Helvetica').fontSize(11).fillColor('#000000');
    doc.text(aluno.data_nascimento, 380, dadosY + 13);
  }
  doc.y = dadosY + 35;

  // Data de conclusão por extenso
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(11).fillColor('#000000');
  doc.text(
    `${faculdadeNome}, aos ${dateFmt}.`,
    { align: 'center' }
  );

  // ===== ASSINATURA =====
  doc.moveDown(1.5);
  const centro = largura / 2;
  const assinatura = getAssinaturaAtiva();
  const nomeAss = assinatura?.nome_signatario || diretor;
  const cargoAss = assinatura?.cargo || 'Diretor Geral';
  const temCertificado = !!(
    (assinatura?.certificado_path && fs.existsSync(assinatura.certificado_path)) ||
    (assinatura?.certificado_tipo === 'A3' && !!assinatura.certificado_a3_thumbprint)
  );
  const temImagem = !semAssinatura && !!(assinatura?.imagem_path && fs.existsSync(assinatura.imagem_path));

  let assH = 0;
  const assW = 238;
  if (assinatura?.imagem_path && fs.existsSync(assinatura.imagem_path)) {
    try {
      const dim = getImageSize(assinatura.imagem_path);
      assH = (dim.height / dim.width) * assW;
    } catch { /* ignora */ }
  }
  const linhaAss = doc.y + assH;
  if (temImagem) {
    try {
      const dim = getImageSize(assinatura!.imagem_path!);
      const bounds = getPngContentBounds(assinatura!.imagem_path!);
      const baselineFrac = bounds ? bounds.baseline / dim.height : 1;
      const imageTop = linhaAss - baselineFrac * assH + 2.835;
      doc.image(assinatura!.imagem_path!, centro - assW / 2, imageTop, { width: assW });
    } catch { /* ignora */ }
  }
  doc.y = linhaAss;

  doc.moveTo(centro - 130, doc.y).lineTo(centro + 130, doc.y).lineWidth(0.7).strokeColor('#000000').stroke();
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000');
  doc.text(nomeAss, centro - 130, doc.y + 3, { width: 260, align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor('#444444');
  doc.text(cargoAss, centro - 130, doc.y, { width: 260, align: 'center' });
  if (temCertificado) {
    doc.font('Helvetica').fontSize(7).fillColor('#666666');
    doc.text('Assinado digitalmente com certificado ICP-Brasil', centro - 130, doc.y, { width: 260, align: 'center' });
  }

  // ===== QR CODE + VERIFICAÇÃO =====
  doc.moveDown(1.5);
  const qrSize = 90;
  const qrX = largura - 60 - qrSize;
  const qrY = doc.y;
  doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
  doc.font('Helvetica').fontSize(7).fillColor('#666666');
  doc.text('Escaneie para verificar', qrX, qrY + qrSize + 2, { width: qrSize, align: 'center' });

  // Código de verificação
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#666666');
  doc.text('CÓDIGO DE VERIFICAÇÃO', 60, qrY + 5);
  doc.font('Courier').fontSize(9).fillColor('#000000');
  doc.text(codigo.substring(0, 36), 60, qrY + 18, { width: 250 });

  // Hash
  doc.moveDown(2);
  doc.moveTo(60, doc.y).lineTo(largura - 60, doc.y).strokeColor('#cccccc').lineWidth(0.5).stroke();
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(7).fillColor('#888888');
  doc.text(`Hash: ${hash.substring(0, 48)}...`, 60, doc.y);
  doc.text('Documento válido em todo território nacional.', 60, doc.y);

  return new Promise<void>((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.end();
  });
}

async function emitir(
  event: IpcMainInvokeEvent,
  alunoId: number,
  semAssinatura = false,
  senhaPfx?: string
): Promise<ApiResult<{ id: number; codigo_verificacao: string; hash_conteudo: string; enviado_web: number; pdfPath: string; enviadoWeb: boolean }>> {
  const sessao = getSessao();
  if (!sessao) return { ok: false, error: 'Não autenticado' };

  const db = getDb();
  const aluno = db.prepare('SELECT * FROM alunos WHERE id = ?').get(alunoId) as Aluno | undefined;
  if (!aluno) return { ok: false, error: 'Aluno não encontrado' };

  const codigo = randomUUID();
  const agora = new Date().toISOString();
  const hash = gerarHashConteudo(aluno, agora);

  let info;
  try {
    info = db
      .prepare(
        `INSERT INTO diplomas (aluno_id, codigo_verificacao, hash_conteudo, emitido_por)
         VALUES (?, ?, ?, ?)`
      )
      .run(aluno.id, codigo, hash, sessao.usuario.id);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erro ao registrar diploma' };
  }

  const diplomaId = info.lastInsertRowid as number;

  const win = BrowserWindow.fromWebContents(event.sender);
  const nomeArquivo = montarNomePdf('diploma', aluno.nome, aluno.matricula, diplomaId);

  const diplomasDir = path.join(app.getPath('userData'), 'diplomas');
  if (!fs.existsSync(diplomasDir)) fs.mkdirSync(diplomasDir, { recursive: true });
  const caminhoInterno = path.join(diplomasDir, `${diplomaId}.pdf`);

  const destino =
    win != null
      ? await dialog.showSaveDialog(win, {
          title: 'Salvar Diploma',
          defaultPath: nomeArquivo,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        })
      : { canceled: true, filePath: '' };

  if (destino.canceled || !destino.filePath) {
    db.prepare('DELETE FROM diplomas WHERE id = ?').run(diplomaId);
    return { ok: false, error: 'Operação cancelada pelo usuário' };
  }

  const urlVerificacao = gerarUrlValidacao({
    n: aluno.nome,
    m: aluno.matricula || String(aluno.id),
    c: aluno.curso || undefined,
    f: aluno.faculdade || undefined,
    t: 'Diploma de Conclusão',
    e: agora,
    k: codigo,
  });
  const qrBuffer = await gerarQrPng(urlVerificacao);

  const fac = getFaculdadeInfo(aluno.faculdade);
  const cursoInfo = aluno.curso && fac.cursos[aluno.curso] ? fac.cursos[aluno.curso] : null;
  const cursoTexto = (cursoInfo?.nome || aluno.curso || '').toUpperCase();
  const diretor = fac.diretor || '—';
  const faculdadeNome = fac.nome || aluno.faculdade || '—';
  const discRows = db.prepare('SELECT ch FROM historico_disciplinas WHERE aluno_id = ?').all(aluno.id) as { ch: string | null }[];
  const cargaHorariaTotal = discRows.reduce((s, d) => {
    const n = parseInt((d.ch ?? '').replace(/\D/g, '') || '0', 10);
    return s + (isNaN(n) ? 0 : n);
  }, 0);

  await gerarPdf({
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
    semAssinatura,
  });

  // Assinatura digital PAdES (A1/A3) — automática quando há certificado ativo.
  const assinado = await assinarPdfSeConfigurado(destino.filePath, { semAssinatura, senha: senhaPfx, razao: 'Diploma de Conclusão' });
  if (!assinado.ok) {
    try { fs.unlinkSync(destino.filePath); } catch { /* noop */ }
    db.prepare('DELETE FROM diplomas WHERE id = ?').run(diplomaId);
    return { ok: false, error: assinado.error ?? 'Falha ao assinar o diploma.' };
  }

  try {
    fs.copyFileSync(destino.filePath, caminhoInterno);
    db.prepare('UPDATE diplomas SET pdf_caminho = ? WHERE id = ?').run(caminhoInterno, diplomaId);
  } catch { /* ignora */ }

  return {
    ok: true,
    data: {
      id: diplomaId,
      codigo_verificacao: codigo,
      hash_conteudo: hash,
      enviado_web: 0,
      pdfPath: destino.filePath,
      enviadoWeb: false,
    },
  };
}

function listar(_event: IpcMainInvokeEvent, alunoId?: number): ApiResult<any[]> {
  const db = getDb();
  const sql = `SELECT d.*, a.nome AS aluno_nome, a.matricula AS aluno_matricula,
                      u.nome AS emitido_por_nome, u.codigo AS emitido_por_codigo
               FROM diplomas d
               JOIN alunos a ON a.id = d.aluno_id
               JOIN usuarios u ON u.id = d.emitido_por`;
  const rows =
    alunoId != null
      ? db.prepare(sql + ' WHERE d.aluno_id = ? ORDER BY d.emitido_em DESC').all(alunoId)
      : db.prepare(sql + ' ORDER BY d.emitido_em DESC').all();
  return { ok: true, data: rows };
}

async function excluir(
  _event: IpcMainInvokeEvent,
  id: number,
  senha: string
): Promise<ApiResult<{ ok: true }>> {
  const sessao = getSessao();
  if (!sessao) return { ok: false, error: 'Não autenticado' };
  if (sessao.usuario.username !== 'admin') {
    return { ok: false, error: 'Apenas o administrador pode excluir diplomas' };
  }
  if (!validarSenhaMaster(senha, CONFIG.SENHA_EXCLUSAO_DECLARACAO_HASH)) {
    return { ok: false, error: 'Senha de exclusão incorreta' };
  }
  const db = getDb();
  const dip = db.prepare('SELECT id FROM diplomas WHERE id = ?').get(id);
  if (!dip) return { ok: false, error: 'Diploma não encontrado' };
  db.prepare('DELETE FROM diplomas WHERE id = ?').run(id);
  return { ok: true, data: { ok: true } };
}

async function baixar(
  event: IpcMainInvokeEvent,
  id: number
): Promise<ApiResult<{ salvoPath: string }>> {
  const db = getDb();
  const dip = db.prepare('SELECT * FROM diplomas WHERE id = ?').get(id) as any | undefined;
  if (!dip) return { ok: false, error: 'Diploma não encontrado' };

  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, error: 'Janela não disponível' };

  let pdfPath = dip.pdf_caminho || '';
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    pdfPath = path.join(app.getPath('userData'), 'diplomas', `${id}.pdf`);
  }
  if (!fs.existsSync(pdfPath)) {
    return { ok: false, error: 'Arquivo PDF não encontrado. Re-genere o diploma.' };
  }

  const aluno = db.prepare('SELECT nome, matricula FROM alunos WHERE id = ?').get(dip.aluno_id) as { nome: string; matricula: string } | undefined;
  const nomeSugerido = `diploma-${aluno?.matricula || id}.pdf`;

  const res = await dialog.showSaveDialog(win, {
    title: 'Salvar Cópia do Diploma',
    defaultPath: nomeSugerido,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });

  if (res.canceled || !res.filePath) return { ok: false, error: 'Operação cancelada' };
  fs.copyFileSync(pdfPath, res.filePath);
  return { ok: true, data: { salvoPath: res.filePath } };
}

export function registrarDiplomaHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.DIPLOMA_EMITIR, requerAuth(emitir));
  ipcMain.handle(IPC_CHANNELS.DIPLOMA_LISTAR, requerAuth(listar));
  ipcMain.handle(IPC_CHANNELS.DIPLOMA_EXCLUIR, requerAuth(excluir));
  ipcMain.handle(IPC_CHANNELS.DIPLOMA_BAIXAR, requerAuth(baixar));
}
