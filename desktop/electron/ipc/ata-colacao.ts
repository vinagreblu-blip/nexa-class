import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { getDb } from '../database';
import { getFaculdadeInfo } from '../faculdades';
import { IPC_CHANNELS } from '../types';
import type {
  Aluno,
  ApiResult,
  AtaColacaoConcluinte,
  AtaColacaoDados,
} from '../types';
import { getSessao, requerAuth } from './auth';
import { agendarCompartilharPdf } from '../pdf-sync';
import { formatarDataExtensoBrasilia } from '../utils';
import { montarNomePdf } from '../utils/sistema';
import { logger } from '../utils/logger';

interface AtaColacaoRow {
  id: number;
  aluno_id: number;
  numero_ata: string | null;
  data: string | null;
  horario: string | null;
  plataforma: string | null;
  instituicao: string | null;
  cidade: string | null;
  estado: string | null;
  grau: string | null;
  modalidade: string | null;
  presidente_nome: string | null;
  presidente_cargo: string | null;
  diretor_nome: string | null;
  diretor_cargo: string | null;
  pdf_caminho: string | null;
  emitido_por: number | null;
  emitido_em: string | null;
  created_at: string;
  updated_at: string;
}

const BRANCO = '__________________';

function limpar(v: string | null | undefined): string {
  if (!v) return '';
  const t = String(v).trim();
  return t;
}

function ouBranco(v: string | null | undefined): string {
  const t = limpar(v);
  return t || BRANCO;
}

function listarConcluintes(
  _event: IpcMainInvokeEvent,
  busca?: string
): ApiResult<AtaColacaoConcluinte[]> {
  const db = getDb();
  const sql = `SELECT a.id, a.matricula, a.nome, a.cpf, a.rg, a.curso, a.faculdade,
                      a.ano_conclusao, a.data_colacao,
                      ata.id AS ata_id, ata.numero_ata, ata.emitido_em
               FROM alunos a
               LEFT JOIN atas_colacao ata ON ata.aluno_id = a.id
               WHERE (a.ano_conclusao IS NOT NULL AND a.ano_conclusao != '')
                  OR (a.data_colacao IS NOT NULL AND a.data_colacao != '')
               ORDER BY a.nome ASC`;

  const rows = db.prepare(sql).all() as AtaColacaoConcluinte[];

  const termo = limpar(busca).toLowerCase();
  const filtrados = termo
    ? rows.filter(
        (r) =>
          r.nome?.toLowerCase().includes(termo) ||
          r.matricula?.toLowerCase().includes(termo) ||
          r.curso?.toLowerCase().includes(termo) ||
          r.cpf?.toLowerCase().includes(termo)
      )
    : rows;

  return { ok: true, data: filtrados };
}

function obter(_event: IpcMainInvokeEvent, alunoId: number): ApiResult<AtaColacaoRow | null> {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM atas_colacao WHERE aluno_id = ?')
    .get(alunoId) as AtaColacaoRow | undefined;
  return { ok: true, data: row ?? null };
}

function salvar(
  _event: IpcMainInvokeEvent,
  dados: AtaColacaoDados
): ApiResult<AtaColacaoRow> {
  const sessao = getSessao();
  if (!sessao) return { ok: false, error: 'Não autenticado' };

  const db = getDb();
  const aluno = db.prepare('SELECT id FROM alunos WHERE id = ?').get(dados.aluno_id);
  if (!aluno) return { ok: false, error: 'Aluno não encontrado' };

  const valores = [
    limpar(dados.numero_ata) || null,
    limpar(dados.data) || null,
    limpar(dados.horario) || null,
    limpar(dados.plataforma) || null,
    limpar(dados.instituicao) || null,
    limpar(dados.cidade) || null,
    limpar(dados.estado) || null,
    limpar(dados.grau) || null,
    limpar(dados.modalidade) || 'EAD',
    limpar(dados.presidente_nome) || null,
    limpar(dados.presidente_cargo) || null,
    limpar(dados.diretor_nome) || null,
    limpar(dados.diretor_cargo) || null,
  ];

  const existente = db
    .prepare('SELECT id FROM atas_colacao WHERE aluno_id = ?')
    .get(dados.aluno_id) as { id: number } | undefined;

  try {
    if (existente) {
      db.prepare(
        `UPDATE atas_colacao
         SET numero_ata = ?, data = ?, horario = ?, plataforma = ?, instituicao = ?,
             cidade = ?, estado = ?, grau = ?, modalidade = ?, presidente_nome = ?,
             presidente_cargo = ?, diretor_nome = ?, diretor_cargo = ?,
             updated_at = datetime('now')
         WHERE aluno_id = ?`
      ).run(...valores, dados.aluno_id);
    } else {
      db.prepare(
        `INSERT INTO atas_colacao
           (aluno_id, numero_ata, data, horario, plataforma, instituicao, cidade, estado,
            grau, modalidade, presidente_nome, presidente_cargo, diretor_nome, diretor_cargo, emitido_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(dados.aluno_id, ...valores, sessao.usuario.id);
    }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erro ao salvar ata' };
  }

  const row = db
    .prepare('SELECT * FROM atas_colacao WHERE aluno_id = ?')
    .get(dados.aluno_id) as AtaColacaoRow;
  return { ok: true, data: row };
}

interface PdfOpts {
  aluno: Aluno;
  ata: AtaColacaoRow;
  destinoPath: string;
  faculdade: ReturnType<typeof getFaculdadeInfo>;
}

function formatarDataPT(iso: string | null): string {
  const t = limpar(iso);
  if (!t) return BRANCO;
  const d = new Date(t + (t.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d.getTime())) return t;
  return formatarDataExtensoBrasilia(d);
}

function gerarPdf(opts: PdfOpts): Promise<void> {
  const { aluno, ata, destinoPath, faculdade } = opts;

  const doc = new PDFDocument({ size: 'A4', margin: 70 });
  const stream = fs.createWriteStream(destinoPath);
  stream.on('error', () => {});
  doc.pipe(stream);

  const largura = doc.page.width;
  const esquerda = 70;
  const direita = largura - 70;
  const conteudoLargura = direita - esquerda;

  const instituicao = limpar(ata.instituicao) || faculdade.nome || limpar(aluno.faculdade) || '';
  const cidade = limpar(ata.cidade) || BRANCO;
  const estado = limpar(ata.estado) || BRANCO;
  const numeroAta = ouBranco(ata.numero_ata);
  const dataSessao = ouBranco(ata.data);
  const horario = ouBranco(ata.horario);
  const plataforma = ouBranco(ata.plataforma);
  const grau = ouBranco(ata.grau);
  const modalidade = limpar(ata.modalidade) || 'EAD';
  const cursoTexto = (limpar(aluno.curso) || BRANCO).toUpperCase();
  const dataConclusao = ouBranco(aluno.data_colacao || aluno.ano_conclusao);

  // ===== CABEÇALHO =====
  const logoExiste = faculdade.logoPath && fs.existsSync(faculdade.logoPath);
  if (logoExiste) {
    const logoW = 65;
    const gap = 10;
    try {
      doc.image(faculdade.logoPath!, esquerda, 50, { width: logoW });
    } catch {
      /* ignora */
    }
    const textoX = esquerda + logoW + gap;
    const textoWidth = direita - textoX;
    doc.fillColor('#000000');
    doc.font('Helvetica-Bold').fontSize(13);
    doc.text(instituicao || faculdade.nome, textoX, 55, { width: textoWidth, align: 'center' });
    doc.y = Math.max(doc.y, 50 + logoW);
  } else {
    doc.fillColor('#000000');
    doc.font('Helvetica-Bold').fontSize(14);
    doc.text(instituicao || faculdade.nome, esquerda, 60, {
      width: conteudoLargura,
      align: 'center',
    });
    doc.y += 8;
  }

  // Linha separadora
  doc.y += 8;
  doc.moveTo(esquerda, doc.y).lineTo(direita, doc.y).lineWidth(1).strokeColor('#000000').stroke();
  doc.y += 18;

  // ===== TÍTULO =====
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#000000');
  doc.text('ATA DE COLAÇÃO DE GRAU INDIVIDUAL', esquerda, doc.y, {
    width: conteudoLargura,
    align: 'center',
  });
  doc.moveDown(0.4);
  doc.moveTo(esquerda + 80, doc.y).lineTo(direita - 80, doc.y).lineWidth(0.5).strokeColor('#666666').stroke();
  doc.moveDown(1);

  // ===== IDENTIFICAÇÃO DA ATA =====
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#666666');
  doc.text('NÚMERO DA ATA', esquerda, doc.y);
  doc.font('Helvetica').fontSize(11).fillColor('#000000');
  doc.text(numeroAta, esquerda, doc.y + 12);
  const afterNumero = doc.y + 16;

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#666666');
  doc.text('INSTITUIÇÃO', esquerda, afterNumero);
  doc.font('Helvetica').fontSize(11).fillColor('#000000');
  doc.text(instituicao || BRANCO, esquerda, afterNumero + 12);
  doc.y = afterNumero + 32;

  // Data / Horário / Plataforma em 3 colunas
  const linhaInfoY = doc.y;
  const colW = conteudoLargura / 3;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#666666');
  doc.text('DATA DA SESSÃO', esquerda, linhaInfoY);
  doc.text('HORÁRIO', esquerda + colW, linhaInfoY);
  doc.text('PLATAFORMA', esquerda + colW * 2, linhaInfoY);
  doc.font('Helvetica').fontSize(11).fillColor('#000000');
  doc.text(dataSessao, esquerda, linhaInfoY + 12, { width: colW - 8 });
  doc.text(horario, esquerda + colW, linhaInfoY + 12, { width: colW - 8 });
  doc.text(plataforma, esquerda + colW * 2, linhaInfoY + 12, { width: colW - 8 });
  doc.y = linhaInfoY + 34;

  // Cidade / Estado / Curso
  const linhaLocY = doc.y;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#666666');
  doc.text('CIDADE', esquerda, linhaLocY);
  doc.text('ESTADO', esquerda + colW, linhaLocY);
  doc.text('GRAU / MODALIDADE', esquerda + colW * 2, linhaLocY);
  doc.font('Helvetica').fontSize(11).fillColor('#000000');
  doc.text(cidade, esquerda, linhaLocY + 12, { width: colW - 8 });
  doc.text(estado, esquerda + colW, linhaLocY + 12, { width: colW - 8 });
  doc.text(`${grau} · ${modalidade}`, esquerda + colW * 2, linhaLocY + 12, { width: colW - 8 });
  doc.y = linhaLocY + 34;

  // Curso
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#666666');
  doc.text('CURSO', esquerda, doc.y);
  doc.font('Helvetica').fontSize(11).fillColor('#000000');
  doc.text(cursoTexto, esquerda, doc.y + 12);
  doc.y += 36;

  // Linha divisória
  doc.moveTo(esquerda, doc.y).lineTo(direita, doc.y).lineWidth(0.5).strokeColor('#cccccc').stroke();
  doc.moveDown(1);

  // ===== DADOS DO CONCLUINTE =====
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000');
  doc.text('DADOS DO CONCLUINTE', esquerda, doc.y, { width: conteudoLargura });
  doc.moveDown(0.6);

  doc.font('Helvetica').fontSize(11).fillColor('#000000');
  const dadosConcl = [
    `Nome: ${ouBranco(aluno.nome)}`,
    `CPF: ${ouBranco(aluno.cpf)}     RG: ${ouBranco(aluno.rg)}     Matrícula: ${ouBranco(aluno.matricula)}`,
    `Data de conclusão do curso: ${dataConclusao}`,
  ];
  for (const linha of dadosConcl) {
    doc.text(linha, esquerda, doc.y, { width: conteudoLargura, align: 'justify', lineGap: 3 });
    doc.moveDown(0.3);
  }
  doc.moveDown(0.8);

  // ===== PRESIDENTE E SECRETÁRIO =====
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000');
  doc.text('COMPOSIÇÃO DA MESA', esquerda, doc.y, { width: conteudoLargura });
  doc.moveDown(0.6);

  doc.font('Helvetica').fontSize(11).fillColor('#000000');
  doc.text(
    `Presidente da Sessão: ${ouBranco(ata.presidente_nome)} — Cargo: ${ouBranco(ata.presidente_cargo)}`,
    esquerda,
    doc.y,
    { width: conteudoLargura, align: 'justify', lineGap: 3 }
  );
  doc.moveDown(0.3);
  doc.text(
    `Diretor(a): ${ouBranco(ata.diretor_nome)} — Cargo: ${ouBranco(ata.diretor_cargo)}`,
    esquerda,
    doc.y,
    { width: conteudoLargura, align: 'justify', lineGap: 3 }
  );
  doc.moveDown(1);

  // ===== TEXTO FORMAL =====
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000');
  doc.text('DISPOSITIVO', esquerda, doc.y, { width: conteudoLargura });
  doc.moveDown(0.6);

  doc.font('Helvetica').fontSize(11).fillColor('#000000');
  const paragrafos = [
    `Aos ${formatarDataPT(ata.data)} , em sessão solene realizada às ${horario}, ` +
      `a ${instituicao || BRANCO}, sediada em ${cidade}/${estado}, procedeu à colação de grau ` +
      `individual do(a) concluinte abaixo identificado(a), na modalidade ${modalidade}, ` +
      `em conformidade com o Regulamento Acadêmico da Instituição e a legislação educacional vigente.`,

    `Devidamente verificada a identidade do(a) concluinte ${ouBranco(aluno.nome)}, ` +
      `portador(a) do CPF ${ouBranco(aluno.cpf)} e da matrícula ${ouBranco(aluno.matricula)}, ` +
      `e confirmada a regular integralização do curso de ${cursoTexto}, com conclusão em ${dataConclusao}, ` +
      `a Mesa declarou cumpridos os requisitos acadêmicos previstos para a outorga do grau de ${grau}.`,

    `Em seguida, o(a) concluinte prestou o juramento solene, comprometendo-se a exercer com ` +
      `dignidade, ética e zelo as atribuições inerentes à profissão, bem como a observar os ` +
      `princípios e deveres estabelecidos pela legislação e pelo ordenamento institucional.`,

    `Atendidos os requisitos formais e legais, a Mesa conferiu, oficialmente, o grau de ${grau} ` +
      `ao(à) concluinte ${ouBranco(aluno.nome)}, outorgando-lhe os direitos, honrarias e prerrogativas ` +
      `a ele inerentes. O respectivo diploma será expedido conforme as normas e os prazos institucionais, ` +
      `sendo o presente ato registrado para os devidos fins legais.`,

    `Nada mais havendo a tratar, a sessão foi encerrada e, para constar, foi lavrada a presente ata, ` +
      `que vai assinada pelo Presidente da Sessão e, quando exigido pela Instituição, ` +
      `também pelo(a) concluinte.`,
  ];

  for (const p of paragrafos) {
    doc.text(p, esquerda, doc.y, { width: conteudoLargura, align: 'justify', lineGap: 4 });
    doc.moveDown(0.7);
  }

  // ===== ASSINATURAS =====
  doc.moveDown(1);
  const colunas = [
    {
      titulo: 'Presidente da Sessão',
      nome: ouBranco(ata.presidente_nome),
      cargo: ouBranco(ata.presidente_cargo),
    },
    {
      titulo: 'Concluinte',
      nome: ouBranco(aluno.nome),
      cargo: 'Concluinte',
    },
  ];

  const assW = (conteudoLargura - 12) / 2;
  const baseY = doc.y;
  colunas.forEach((c, i) => {
    const x = esquerda + i * (assW + 12);
    doc.moveTo(x, baseY).lineTo(x + assW, baseY).lineWidth(0.7).strokeColor('#000000').stroke();
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#666666');
    doc.text('NOME', x, baseY + 4, { width: assW });
    doc.font('Helvetica').fontSize(10).fillColor('#000000');
    doc.text(c.nome, x, baseY + 15, { width: assW });
    let yy = baseY + 32;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#666666');
    doc.text('CARGO', x, yy, { width: assW });
    yy += 11;
    doc.font('Helvetica').fontSize(10).fillColor('#000000');
    doc.text(c.cargo, x, yy, { width: assW });
    yy += 17;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#666666');
    doc.text('ASSINATURA ELETRÔNICA', x, yy, { width: assW });
    yy += 11;
    doc.font('Helvetica').fontSize(9).fillColor('#444444');
    doc.text('_______________________', x, yy, { width: assW });
  });

  // Rodapé
  doc.moveDown(6);
  doc.moveTo(esquerda, doc.y).lineTo(direita, doc.y).strokeColor('#cccccc').lineWidth(0.5).stroke();
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(7).fillColor('#888888');
  doc.text(
    `Documento gerado em ${formatarDataExtensoBrasilia(new Date())}. ` +
      `Ato realizado nos termos da legislação educacional vigente.`,
    esquerda,
    doc.y,
    { width: conteudoLargura, align: 'center' }
  );

  return new Promise<void>((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.end();
  });
}

async function gerarPdfHandler(
  event: IpcMainInvokeEvent,
  alunoId: number
): Promise<ApiResult<{ pdfPath: string }>> {
  const sessao = getSessao();
  if (!sessao) return { ok: false, error: 'Não autenticado' };

  logger.info({ alunoId, userId: sessao.usuario.id }, 'Ata: iniciando geração de PDF');

  const db = getDb();
  const aluno = db.prepare('SELECT * FROM alunos WHERE id = ?').get(alunoId) as Aluno | undefined;
  if (!aluno) {
    logger.warn({ alunoId }, 'Ata: aluno não encontrado');
    return { ok: false, error: 'Aluno não encontrado' };
  }
  logger.info({ alunoId, alunoNome: aluno.nome }, 'Ata: aluno encontrado');

  const ata = db
    .prepare('SELECT * FROM atas_colacao WHERE aluno_id = ?')
    .get(alunoId) as AtaColacaoRow | undefined;
  if (!ata) {
    logger.warn({ alunoId }, 'Ata: ata não cadastrada — usuário precisa editar antes de gerar');
    return {
      ok: false,
      error: 'Não há dados de ata cadastrados para este aluno. Clique em "Editar" e salve os dados da ata antes de gerar o PDF.',
    };
  }
  logger.info({ alunoId, ataId: ata.id }, 'Ata: ata encontrada no DB');

  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    logger.error({ alunoId }, 'Ata: BrowserWindow não disponível');
    return { ok: false, error: 'Janela do app não disponível para abrir diálogo de salvar.' };
  }

  const nomeArquivo = montarNomePdf('ata-colacao', aluno.nome, aluno.matricula || String(aluno.id), ata.id);

  logger.info({ alunoId, nomeArquivo }, 'Ata: abrindo diálogo salvar como');
  const destino = await dialog.showSaveDialog(win, {
    title: 'Salvar Ata de Colação de Grau',
    defaultPath: nomeArquivo,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });

  if (destino.canceled || !destino.filePath) {
    logger.info({ alunoId }, 'Ata: usuário cancelou diálogo de salvar');
    return { ok: false, error: 'Operação cancelada pelo usuário' };
  }
  logger.info({ alunoId, destinoPath: destino.filePath }, 'Ata: destino selecionado');

  const fac = getFaculdadeInfo(aluno.faculdade);
  if (!fac || !fac.nome) {
    logger.warn({ alunoId, faculdade: aluno.faculdade }, 'Ata: faculdade não encontrada em getFaculdadeInfo');
  }

  try {
    logger.info({ alunoId }, 'Ata: chamando gerarPdf');
    await gerarPdf({ aluno, ata, destinoPath: destino.filePath, faculdade: fac });
    logger.info({ alunoId, destinoPath: destino.filePath }, 'Ata: PDF gerado com sucesso');
  } catch (e: any) {
    logger.error({ err: e, alunoId }, 'Ata: erro ao gerar PDF');
    return {
      ok: false,
      error: `Erro ao gerar PDF: ${e?.message ?? 'erro desconhecido'}. Verifique se todos os dados da ata estão preenchidos e tente novamente.`,
    };
  }

  // Salva caminho interno + marca data de emissão
  const atasDir = path.join(app.getPath('userData'), 'atas-colacao');
  if (!fs.existsSync(atasDir)) fs.mkdirSync(atasDir, { recursive: true });
  const caminhoInterno = path.join(atasDir, `${ata.id}.pdf`);
  try {
    fs.copyFileSync(destino.filePath, caminhoInterno);
    db.prepare('UPDATE atas_colacao SET pdf_caminho = ?, emitido_em = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?')
      .run(caminhoInterno, ata.id);
    logger.info({ alunoId, caminhoInterno }, 'Ata: cópia interna salva');
    // Compartilha o PDF assinado na nuvem (as outras máquinas baixam depois).
    agendarCompartilharPdf('atas_colacao', ata.id, caminhoInterno);
  } catch (e: any) {
    logger.warn({ err: e, alunoId }, 'Ata: falha ao salvar cópia interna (não crítico)');
  }

  return { ok: true, data: { pdfPath: destino.filePath } };
}

export function registrarAtaColacaoHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ATA_COLACAO_LISTAR_CONCLUINTES, requerAuth(listarConcluintes));
  ipcMain.handle(IPC_CHANNELS.ATA_COLACAO_OBTER, requerAuth(obter));
  ipcMain.handle(IPC_CHANNELS.ATA_COLACAO_SALVAR, requerAuth(salvar));
  ipcMain.handle(IPC_CHANNELS.ATA_COLACAO_GERAR_PDF, requerAuth(gerarPdfHandler));
}
