import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { getDb } from '../database';
import { IPC_CHANNELS } from '../types';
import type { ApiResult } from '../types';
import { getSessao, requerAuth } from './auth';
import { getAssinaturaAtiva } from './assinatura';
import { assinarPdfSeConfigurado } from '../pades';
import { gerarUrlValidacao } from '../qr-validador';
import { montarNomePdf } from '../utils/sistema';
import { getImageSize, getPngContentBounds } from '../image-size';
import { gerarQrPng, formatarDataExtensoBrasilia } from '../utils';
import { agendarCompartilharPdf, garantirPdfLocal } from '../pdf-sync';

export interface CertificadoRow {
  id: number;
  curso_livre_id: number;
  aluno_id: number;
  codigo_verificacao: string;
  hash_conteudo: string;
  emitido_por: number;
  emitido_em: string;
  pdf_caminho: string | null;
  aluno_nome: string;
  aluno_matricula: string;
  curso_nome: string;
}

function escapeTexto(s: string): string {
  return (s || '').replace(/[<>&]/g, '');
}

function hashCertificado(cursoLivreId: number, alunoId: number, nome: string, curso: string, ts: string): string {
  const payload = [cursoLivreId, alunoId, nome, curso, ts].join('|');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

function formatarData(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  } catch {
    return iso;
  }
}

async function gerarPdfCertificado(opts: {
  destinoPath: string;
  alunoNome: string;
  alunoCpf: string | null;
  cursoNome: string;
  cursoDescricao: string | null;
  cargaHoraria: string | null;
  dataInicio: string | null;
  dataFim: string | null;
  codigo: string;
  qrBuffer: Buffer;
  emitidoEm: string;
}): Promise<void> {
  const {
    destinoPath, alunoNome, alunoCpf, cursoNome, cursoDescricao, cargaHoraria,
    dataInicio, dataFim, codigo, qrBuffer, emitidoEm,
  } = opts;

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 60 });
  const stream = fs.createWriteStream(destinoPath);
  stream.on('error', () => {});
  doc.pipe(stream);

  const largura = doc.page.width;
  const altura = doc.page.height;
  void altura;
  const centro = largura / 2;

  // Moldura
  doc.rect(28, 28, largura - 56, doc.page.height - 56).lineWidth(2).strokeColor('#1f4e5f').stroke();
  doc.rect(38, 38, largura - 76, doc.page.height - 76).lineWidth(0.5).strokeColor('#1f4e5f').stroke();

  // Cabeçalho
  doc.fillColor('#1f4e5f').font('Helvetica-Bold').fontSize(13).text('NEXA CLASS', centro, 70, { align: 'center' });
  doc.fillColor('#666666').font('Helvetica').fontSize(9).text('Plataforma Acadêmica', centro, 88, { align: 'center' });

  // Título
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(40).text('CERTIFICADO', centro, 140, { align: 'center' });
  doc.moveTo(centro - 70, 192).lineTo(centro + 70, 192).lineWidth(1.2).strokeColor('#1f4e5f').stroke();

  // Corpo
  doc.fillColor('#334155').font('Helvetica').fontSize(13).text('Certificamos que', centro, 215, { align: 'center' });

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(22).text(escapeTexto(alunoNome), centro, 245, { align: 'center' });
  if (alunoCpf) {
    doc.fillColor('#64748b').font('Helvetica').fontSize(10).text(`CPF: ${alunoCpf}`, centro, 278, { align: 'center' });
  }

  const ch = cargaHoraria ? cargaHoraria.replace(/\D/g, '') : '';
  const periodo = dataInicio || dataFim
    ? ` no período de ${formatarData(dataInicio) || '___'} a ${formatarData(dataFim) || '___'}`
    : '';
  const chTexto = ch ? ` com carga horária de ${ch} horas` : '';

  doc.fillColor('#334155').font('Helvetica').fontSize(12);
  const corpo = `concluiu satisfatoriamente o curso ${escapeTexto(cursoNome)}${chTexto}${periodo}.`;
  doc.text(corpo, 110, 308, { align: 'center', width: largura - 220, lineGap: 3 });

  if (cursoDescricao) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#64748b');
    doc.text(escapeTexto(cursoDescricao), 160, doc.y + 6, { align: 'center', width: largura - 320 });
  }

  // Data de emissão
  doc.font('Helvetica').fontSize(10).fillColor('#334155');
  doc.text(`Emitido em ${formatarDataExtensoBrasilia(emitidoEm)}`, centro, doc.y + 24, { align: 'center' });

  // Assinatura (imagem) + código
  const assinatura = getAssinaturaAtiva();
  const temImagem = !!(assinatura?.imagem_path && fs.existsSync(assinatura.imagem_path));
  const linhaY = doc.page.height - 120;
  if (temImagem) {
    try {
      const dim = getImageSize(assinatura!.imagem_path!);
      const bounds = getPngContentBounds(assinatura!.imagem_path!);
      const assW = 160;
      const assH = (dim.height / dim.width) * assW;
      const baselineFrac = bounds ? bounds.baseline / dim.height : 1;
      const imgTop = linhaY - baselineFrac * assH + 2.5;
      doc.image(assinatura!.imagem_path!, centro - assW / 2, imgTop, { width: assW });
    } catch { /* ignora */ }
  }
  doc.moveTo(centro - 130, linhaY).lineTo(centro + 130, linhaY).lineWidth(0.7).strokeColor('#000000').stroke();
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000');
  doc.text(escapeTexto(assinatura?.nome_signatario || '—'), centro, linhaY + 4, { align: 'center' });
  doc.font('Helvetica').fontSize(8).fillColor('#64748b');
  doc.text(escapeTexto(assinatura?.cargo || 'Diretor Geral'), centro, linhaY + 18, { align: 'center' });

  // QR + código (canto inferior direito)
  doc.image(qrBuffer, largura - 150, doc.page.height - 150, { width: 90 });
  doc.font('Helvetica').fontSize(7).fillColor('#94a3b8');
  doc.text(`Código: ${codigo.substring(0, 13)}…`, largura - 150, doc.page.height - 56, { width: 90, align: 'center' });

  doc.end();
  return new Promise((resolve) => stream.on('finish', () => resolve()));
}

async function certificadoGerar(
  event: IpcMainInvokeEvent,
  cursoLivreId: number,
  alunoId: number,
  senhaPfx?: string
): Promise<ApiResult<{ id: number; pdfPath: string; codigo_verificacao: string }>> {
  const sessao = getSessao();
  if (!sessao) return { ok: false, error: 'Não autenticado' };

  const db = getDb();
  const curso = db.prepare('SELECT * FROM cursos_livres WHERE id = ?').get(cursoLivreId) as
    | { id: number; nome: string; descricao: string | null; carga_horaria: string | null; data_inicio: string | null; data_fim: string | null }
    | undefined;
  if (!curso) return { ok: false, error: 'Curso livre não encontrado' };

  const aluno = db.prepare('SELECT id, nome, matricula, cpf FROM alunos WHERE id = ?').get(alunoId) as
    | { id: number; nome: string; matricula: string; cpf: string | null }
    | undefined;
  if (!aluno) return { ok: false, error: 'Aluno não encontrado' };

  const codigo = randomUUID();
  const agora = new Date().toISOString();
  const hash = hashCertificado(cursoLivreId, alunoId, aluno.nome, curso.nome, agora);

  let info;
  try {
    info = db
      .prepare(
        `INSERT INTO certificados (curso_livre_id, aluno_id, codigo_verificacao, hash_conteudo, emitido_por)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(cursoLivreId, alunoId, codigo, hash, sessao.usuario.id);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erro ao registrar certificado' };
  }
  const certId = info.lastInsertRowid as number;

  const win = BrowserWindow.fromWebContents(event.sender);
  const nomeArquivo = montarNomePdf('certificado', aluno.nome, aluno.matricula || String(aluno.id), certId);
  const destino = win
    ? await dialog.showSaveDialog(win, {
        title: 'Salvar Certificado',
        defaultPath: nomeArquivo,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
    : { canceled: true, filePath: '' };

  if (destino.canceled || !destino.filePath) {
    db.prepare('DELETE FROM certificados WHERE id = ?').run(certId);
    return { ok: false, error: 'Operação cancelada pelo usuário' };
  }

  const urlVerificacao = gerarUrlValidacao({
    n: aluno.nome,
    m: aluno.matricula || String(aluno.id),
    c: 'Certificado: ' + curso.nome,
    e: agora,
    k: codigo,
  });
  let qrBuffer: Buffer;
  try {
    qrBuffer = await gerarQrPng(urlVerificacao);
  } catch {
    db.prepare('DELETE FROM certificados WHERE id = ?').run(certId);
    return { ok: false, error: 'Falha ao gerar QR Code' };
  }

  await gerarPdfCertificado({
    destinoPath: destino.filePath,
    alunoNome: aluno.nome,
    alunoCpf: aluno.cpf,
    cursoNome: curso.nome,
    cursoDescricao: curso.descricao,
    cargaHoraria: curso.carga_horaria,
    dataInicio: curso.data_inicio,
    dataFim: curso.data_fim,
    codigo,
    qrBuffer,
    emitidoEm: agora,
  });

  // Assinatura digital PAdES (A1/A3) — automática quando há certificado ativo.
  const assinado = await assinarPdfSeConfigurado(destino.filePath, { senha: senhaPfx, razao: 'Certificado de Conclusão' });
  if (!assinado.ok) {
    try { fs.unlinkSync(destino.filePath); } catch { /* noop */ }
    db.prepare('DELETE FROM certificados WHERE id = ?').run(certId);
    return { ok: false, error: assinado.error ?? 'Falha ao assinar o certificado.' };
  }

  // Cópia interna
  const certDir = path.join(app.getPath('userData'), 'certificados');
  if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true });
  const caminhoInterno = path.join(certDir, `${certId}.pdf`);
  try {
    fs.copyFileSync(destino.filePath, caminhoInterno);
    db.prepare('UPDATE certificados SET pdf_caminho = ? WHERE id = ?').run(caminhoInterno, certId);
  } catch { /* ignora */ }

  // Compartilha o PDF assinado na nuvem (as outras máquinas baixam no "Baixar").
  agendarCompartilharPdf('certificados', certId, caminhoInterno);

  return { ok: true, data: { id: certId, pdfPath: destino.filePath, codigo_verificacao: codigo } };
}

function certificadoListar(_event: IpcMainInvokeEvent, cursoLivreId: number): ApiResult<CertificadoRow[]> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ce.*, a.nome AS aluno_nome, a.matricula AS aluno_matricula, cl.nome AS curso_nome
       FROM certificados ce
       JOIN alunos a ON a.id = ce.aluno_id
       JOIN cursos_livres cl ON cl.id = ce.curso_livre_id
       WHERE ce.curso_livre_id = ?
       ORDER BY ce.emitido_em DESC`
    )
    .all(cursoLivreId) as CertificadoRow[];
  return { ok: true, data: rows };
}

async function certificadoBaixar(
  event: IpcMainInvokeEvent,
  id: number
): Promise<ApiResult<{ salvoPath: string }>> {
  const db = getDb();
  const row = db.prepare('SELECT * FROM certificados WHERE id = ?').get(id) as
    | { id: number; pdf_caminho: string | null; aluno_id: number }
    | undefined;
  if (!row) return { ok: false, error: 'Certificado não encontrado' };
  let pdfLocal = row.pdf_caminho || '';
  if (!pdfLocal || !fs.existsSync(pdfLocal)) {
    pdfLocal = path.join(app.getPath('userData'), 'certificados', `${id}.pdf`);
  }
  if (!fs.existsSync(pdfLocal)) {
    // Emitido em outra máquina (o token A3 é de uma máquina só): baixa da nuvem.
    const baixou = await garantirPdfLocal('certificados', id, pdfLocal);
    if (!baixou) {
      return {
        ok: false,
        error:
          'PDF do certificado não encontrado nesta máquina nem na nuvem. ' +
          'Se foi emitido em outro computador, peça para que ele esteja conectado à internet e tente novamente.',
      };
    }
  }
  const win = BrowserWindow.fromWebContents(event.sender);
  const nomeArquivo = montarNomePdf('certificado', String(row.id), '', row.id);
  const destino = win
    ? await dialog.showSaveDialog(win, {
        title: 'Salvar Certificado',
        defaultPath: nomeArquivo,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
    : { canceled: true, filePath: '' };
  if (destino.canceled || !destino.filePath) return { ok: false, error: 'Cancelado' };
  fs.copyFileSync(pdfLocal, destino.filePath);
  return { ok: true, data: { salvoPath: destino.filePath } };
}

export function registrarCertificadosHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CERTIFICADO_GERAR, requerAuth(certificadoGerar));
  ipcMain.handle(IPC_CHANNELS.CERTIFICADO_LISTAR, requerAuth(certificadoListar));
  ipcMain.handle(IPC_CHANNELS.CERTIFICADO_BAIXAR, requerAuth(certificadoBaixar));
}
