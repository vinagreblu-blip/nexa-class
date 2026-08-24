import type { IpcMainInvokeEvent} from 'electron';
import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { getDb } from '../database';
import { IPC_CHANNELS } from '../types';
import type { Aluno, ApiResult, HistoricoDisciplina, HistoricoDisciplinaInput } from '../types';
import { getFaculdadeInfo } from '../faculdades';
import { renderHtmlFaciipPdf } from '../faciip-historico-html';
import { renderHtmlHelioRochaPdf } from '../helio-rocha-historico-html';
import { renderHtmlFatecePdf } from '../fatece-historico-html';
import { montarNomePdf, montarNomeArquivo, gravarArquivoSeguro } from '../utils/sistema';
import { renderHtmlDoisDeJulhoPdf } from '../dois-de-julho-historico-html';
import { getSessao, requerAuth } from './auth';
import { getAssinaturaAtiva, assinarXml } from './assinatura';
import { assinarPdfSeConfigurado } from '../pades';
import { gerarUrlValidacao, textoInstrucaoQr } from '../qr-validador';
import { getImageSize, getPngContentBounds } from '../image-size';
import { formatarDataHoraBrasilia } from '../utils';
import { logger } from '../utils/logger';
import { registrarDeclaracaoWeb } from '../web-registro';

// Normaliza nomes de disciplinas/docentes para formato título
function formatarNome(s: string): string {
  if (!s) return '';
  // Se já tem minúsculas, mantém como está
  if (/[a-zà-ÿ]/.test(s) && s !== s.toUpperCase()) return s;
  const pequenas = new Set(['e','de','da','do','das','dos','a','o','as','os','em','no','na','nos','nas','para','com','sem','por','ao','à','às','que','ou']);
  return s.toLowerCase().split(/\s+/).map((p, i) => {
    if (i > 0 && pequenas.has(p.replace(/[^\wÀ-ÿ-]/g, ''))) return p;
    return p.charAt(0).toUpperCase() + p.slice(1);
  }).join(' ');
}

function formatarData(s: string | null | undefined): string {
  if (!s) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

function gerarHashConteudo(aluno: Aluno, emitidoEm: string): string {
  const payload = [aluno.id, aluno.matricula, aluno.nome, aluno.curso ?? '', aluno.faculdade ?? '', emitidoEm].join('|');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

async function gerarQrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: 'png',
    margin: 1,
    width: 200,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

function listar(_event: IpcMainInvokeEvent, alunoId: number): ApiResult<HistoricoDisciplina[]> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM historico_disciplinas WHERE aluno_id = ? ORDER BY periodo ASC, ordem ASC, id ASC`
    )
    .all(alunoId) as HistoricoDisciplina[];
  return { ok: true, data: rows };
}

function validarDisc(d: HistoricoDisciplinaInput): string | null {
  if (!d.periodo?.trim()) return 'Período é obrigatório';
  if (!d.disciplina?.trim()) return 'Disciplina é obrigatória';
  return null;
}

function proximaOrdem(alunoId: number, periodo: string): number {
  const db = getDb();
  const row = db
    .prepare(
      'SELECT COALESCE(MAX(ordem),0) AS maxOrdem FROM historico_disciplinas WHERE aluno_id = ? AND periodo = ?'
    )
    .get(alunoId, periodo) as { maxOrdem: number };
  return (row?.maxOrdem ?? 0) + 1;
}

function criar(
  _event: IpcMainInvokeEvent,
  alunoId: number,
  input: HistoricoDisciplinaInput
): ApiResult<HistoricoDisciplina> {
  const erro = validarDisc(input);
  if (erro) return { ok: false, error: erro };
  const db = getDb();
  const ordem = proximaOrdem(alunoId, input.periodo.trim());
  const info = db
    .prepare(
      `INSERT INTO historico_disciplinas (aluno_id, periodo, disciplina, docente, titulacao, ch, nota, ft, status, ordem)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      alunoId,
      input.periodo.trim(),
      input.disciplina.trim(),
      input.docente?.trim() || null,
      input.titulacao?.trim() || null,
      input.ch?.trim() || null,
      input.nota?.trim() || null,
      input.ft?.trim() || null,
      input.status?.trim() || null,
      ordem
    );
  const row = db
    .prepare('SELECT * FROM historico_disciplinas WHERE id = ?')
    .get(info.lastInsertRowid) as HistoricoDisciplina;
  return { ok: true, data: row };
}

function atualizar(
  _event: IpcMainInvokeEvent,
  id: number,
  input: HistoricoDisciplinaInput
): ApiResult<HistoricoDisciplina> {
  const erro = validarDisc(input);
  if (erro) return { ok: false, error: erro };
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE historico_disciplinas
       SET periodo = ?, disciplina = ?, docente = ?, titulacao = ?, ch = ?, nota = ?, ft = ?, status = ?
       WHERE id = ?`
    )
    .run(
      input.periodo.trim(),
      input.disciplina.trim(),
      input.docente?.trim() || null,
      input.titulacao?.trim() || null,
      input.ch?.trim() || null,
      input.nota?.trim() || null,
      input.ft?.trim() || null,
      input.status?.trim() || null,
      id
    );
  if (result.changes === 0) return { ok: false, error: 'Disciplina não encontrada' };
  const row = db.prepare('SELECT * FROM historico_disciplinas WHERE id = ?').get(id) as HistoricoDisciplina;
  return { ok: true, data: row };
}

function excluir(_event: IpcMainInvokeEvent, id: number): ApiResult<true> {
  const db = getDb();
  const result = db.prepare('DELETE FROM historico_disciplinas WHERE id = ?').run(id);
  if (result.changes === 0) return { ok: false, error: 'Disciplina não encontrada' };
  return { ok: true, data: true };
}

function parseCh(ch: string | null): number {
  if (!ch) return 0;
  const onlyDigits = ch.replace(/\D/g, '');
  return onlyDigits ? parseInt(onlyDigits, 10) : 0;
}

function parseNota(nota: string | null): number | null {
  if (!nota) return null;
  const limpo = nota.replace(',', '.').replace(/[^\d.]/g, '');
  const n = parseFloat(limpo);
  return isNaN(n) ? null : n;
}

function fmtNum(n: number): string {
  return n.toLocaleString('pt-BR');
}

async function gerarPdf(
  event: IpcMainInvokeEvent,
  alunoId: number,
  semAssinatura = false,
  senhaPfx?: string
): Promise<ApiResult<{ pdfPath: string; enviadoWeb: boolean }>> {
  const sessao = getSessao();
  if (!sessao) return { ok: false, error: 'Não autenticado' };

  const db = getDb();
  const aluno = db.prepare('SELECT * FROM alunos WHERE id = ?').get(alunoId) as Aluno | undefined;
  if (!aluno) return { ok: false, error: 'Aluno não encontrado' };

  const disciplinas = db
    .prepare(
      'SELECT * FROM historico_disciplinas WHERE aluno_id = ? ORDER BY periodo ASC, ordem ASC, id ASC'
    )
    .all(alunoId) as HistoricoDisciplina[];

  if (disciplinas.length === 0) {
    return {
      ok: false,
      error: 'Este aluno não possui disciplinas cadastradas no histórico. Adicione as disciplinas primeiro.',
    };
  }

  const win = BrowserWindow.fromWebContents(event.sender);
  const nomeArquivo = montarNomePdf('historico', aluno.nome, aluno.matricula || String(aluno.id), aluno.id);
  const destino = win
    ? await dialog.showSaveDialog(win, {
        title: 'Salvar Histórico Acadêmico',
        defaultPath: nomeArquivo,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
    : { canceled: true, filePath: '' };

  if (destino.canceled || !destino.filePath) {
    return { ok: false, error: 'Operação cancelada' };
  }

  const info = getFaculdadeInfo(aluno.faculdade);
  const cursoInfo = (aluno.curso && info.cursos[aluno.curso]) || null;

  const codigo = randomUUID();
  const emitidoEm = new Date().toISOString();
  const hash = gerarHashConteudo(aluno, emitidoEm);

  // Registra o código localmente (mesmo padrão de declaracoes/diplomas/certificados)
  // para que o QR funcione no serviço de verificação embutido mesmo se o
  // registro no serviço web falhar.
  let historicoId: number;
  try {
    const info = db
      .prepare(
        `INSERT INTO historicos (aluno_id, codigo_verificacao, hash_conteudo, emitido_por, pdf_caminho)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(aluno.id, codigo, hash, sessao.usuario.id, destino.filePath);
    historicoId = Number(info.lastInsertRowid);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erro ao registrar histórico' };
  }

  const webResult = await registrarDeclaracaoWeb({ codigo_verificacao: codigo, hash_conteudo: hash, aluno, emitidoEm });
  if (webResult.ok) {
    db.prepare('UPDATE historicos SET enviado_web = 1 WHERE id = ?').run(historicoId);
  } else {
    logger.warn({ alunoId: aluno.id, erro: webResult.error }, 'Falha ao registrar histórico no serviço web');
  }
  const enviadoWeb = webResult.ok;
  const urlVerificacao = gerarUrlValidacao({
    n: aluno.nome,
    m: aluno.matricula || String(aluno.id),
    c: aluno.curso || undefined,
    f: aluno.faculdade || undefined,
    t: 'Histórico Acadêmico',
    e: emitidoEm,
    k: codigo,
  });
  let qrBuffer: Buffer | null = null;
  try {
    qrBuffer = await gerarQrPng(urlVerificacao);
  } catch {
    qrBuffer = null;
  }

  const renderOpts: RenderOpts = {
    aluno,
    disciplinas,
    faculdade: info,
    cursoInfo,
    destinoPath: destino.filePath,
    codigoVerificacao: codigo,
    qrBuffer,
    urlVerificacao,
    semAssinatura,
    emitidoEm,
  };
  if (aluno.faculdade === 'FACIIP') {
    await renderHtmlFaciipPdf({
      aluno,
      disciplinas,
      faculdade: info,
      cursoInfo,
      destinoPath: destino.filePath,
      codigoVerificacao: codigo,
      qrBuffer,
      semAssinatura,
      emitidoEm,
    });
  } else if (aluno.faculdade === 'Hélio Rocha') {
    await renderHtmlHelioRochaPdf({
      aluno,
      disciplinas,
      faculdade: info,
      cursoInfo,
      destinoPath: destino.filePath,
      codigoVerificacao: codigo,
      qrBuffer,
      semAssinatura,
      emitidoEm,
    });
  } else if (aluno.faculdade === 'FATECE') {
    await renderHtmlFatecePdf({
      aluno,
      disciplinas,
      faculdade: info,
      cursoInfo,
      destinoPath: destino.filePath,
      codigoVerificacao: codigo,
      qrBuffer,
      semAssinatura,
      emitidoEm,
    });
  } else if (aluno.faculdade === '2 de Julho') {
    await renderHtmlDoisDeJulhoPdf({
      aluno,
      disciplinas,
      faculdade: info,
      cursoInfo,
      destinoPath: destino.filePath,
      codigoVerificacao: codigo,
      qrBuffer,
      semAssinatura,
      emitidoEm,
    });
  } else if (aluno.curso === 'Engenharia de Produção Mecânica') {
    await renderHistoricoEngMecPdf(renderOpts);
  } else {
    await renderHistoricoPdf(renderOpts);
  }

  // Assinatura digital PAdES (A1/A3) — automática quando há certificado ativo.
  const assinado = await assinarPdfSeConfigurado(destino.filePath, { semAssinatura, senha: senhaPfx, razao: 'Histórico Escolar' });
  if (!assinado.ok) {
    try { fs.unlinkSync(destino.filePath); } catch { /* noop */ }
    return { ok: false, error: assinado.error ?? 'Falha ao assinar o histórico.' };
  }

  return { ok: true, data: { pdfPath: destino.filePath, enviadoWeb } };
}

interface RenderOpts {
  aluno: Aluno;
  disciplinas: HistoricoDisciplina[];
  faculdade: ReturnType<typeof getFaculdadeInfo>;
  cursoInfo: { nome: string; codEmec: string; turno: string; regulatory: string } | null;
  destinoPath: string;
  codigoVerificacao: string;
  qrBuffer: Buffer | null;
  urlVerificacao: string;
  semAssinatura?: boolean;
  emitidoEm: string;
}

// ===== Fontes (Calibri do Windows, fallback Helvetica) =====
let calibriDisponivel = false;
function registrarFontes(doc: PDFKit.PDFDocument): void {
  const dir = process.env.WINDIR ? path.join(process.env.WINDIR, 'Fonts') : 'C:\\Windows\\Fonts';
  const reg = path.join(dir, 'calibri.ttf');
  const bold = path.join(dir, 'calibrib.ttf');
  const ital = path.join(dir, 'calibrii.ttf');
  if (fs.existsSync(reg) && fs.existsSync(bold)) {
    try {
      doc.registerFont('Calibri', reg);
      doc.registerFont('Calibri-Bold', bold);
      if (fs.existsSync(ital)) doc.registerFont('Calibri-Italic', ital);
      calibriDisponivel = true;
      return;
    } catch {
      /* ignora */
    }
  }
  calibriDisponivel = false;
}
const F_REG = () => (calibriDisponivel ? 'Calibri' : 'Helvetica');
const F_BOLD = () => (calibriDisponivel ? 'Calibri-Bold' : 'Helvetica-Bold');

const MARGEM = 18;
const COLUNAS = [
  { titulo: 'PERÍODO', largura: 48 },
  { titulo: 'DISCIPLINA', largura: 200 },
  { titulo: 'DOCENTES', largura: 155 },
  { titulo: 'TITULAÇÃO', largura: 66 },
  { titulo: 'CH', largura: 35 },
  { titulo: 'N/C', largura: 30 },
  { titulo: 'STC', largura: 25 },
];

function renderHistoricoPdf(opts: RenderOpts): Promise<void> {
  const { aluno, disciplinas, faculdade, cursoInfo, destinoPath, codigoVerificacao, qrBuffer, semAssinatura, emitidoEm, urlVerificacao } = opts;

  const doc = new PDFDocument({ size: 'A4', margin: MARGEM, layout: 'portrait' });
  const stream = fs.createWriteStream(destinoPath);
  stream.on('error', () => {});
  doc.pipe(stream);

  registrarFontes(doc);

  const larguraPagina = doc.page.width;
  const utilizavel = larguraPagina - MARGEM * 2;
  const bottomLimit = doc.page.height - 30;
  const situacao = !aluno.ano_conclusao
    ? '—'
    : aluno.ano_conclusao === 'Cursando'
    ? 'CURSANDO'
    : 'GRADUADO';

  // estado de paginação (redesenha cabeçalho a cada nova página)
  const estado = { y: MARGEM };

  function desenharCabecalho(): number {
    const top = MARGEM;
    let y = top;
    const logoExiste = faculdade.logoPath && fs.existsSync(faculdade.logoPath);

    if (logoExiste) {
      // Logo no canto superior esquerdo + texto do cabeçalho logo ao lado
      const logoW = 70;
      const gap = 6;
      try {
        doc.image(faculdade.logoPath!, MARGEM, y, { width: logoW });
      } catch { /* ignora */ }
      const textoX = MARGEM + logoW + gap;
      const textoWidth = larguraPagina - MARGEM - textoX;
      doc.fillColor('#000000');
      doc.font(F_BOLD()).fontSize(13);
      doc.text('HISTÓRICO ACADÊMICO', textoX, y, { width: textoWidth, align: 'left' });
      y = doc.y + 1;
      doc.font(F_BOLD()).fontSize(11);
      doc.text(faculdade.nome, textoX, y, { width: textoWidth, align: 'left' });
      y = doc.y + 1;
      doc.font(F_REG()).fontSize(8).fillColor('#000000');
      if (faculdade.cnpj) {
        doc.text(
          `CNPJ ${faculdade.cnpj}${faculdade.email ? ' / E-mail.: ' + faculdade.email : ''}${faculdade.telefone ? ' ' + faculdade.telefone : ''}`,
          textoX, y, { width: textoWidth, align: 'left' }
        );
        y = doc.y;
      }
      if (faculdade.endereco) {
        doc.text(`ENDEREÇO: ${faculdade.endereco}`, textoX, y, { width: textoWidth, align: 'left' });
        y = doc.y;
      }
      // garante que o y passa abaixo da logo
      y = Math.max(y, top + logoW);
    } else {
      // Sem logo: texto centralizado em toda a largura
      doc.fillColor('#000000');
      doc.font(F_BOLD()).fontSize(14);
      doc.text('HISTÓRICO ACADÊMICO', MARGEM, y, { width: utilizavel, align: 'center' });
      y = doc.y + 1;
      doc.font(F_BOLD()).fontSize(11);
      doc.text(faculdade.nome, MARGEM, y, { width: utilizavel, align: 'center' });
      y = doc.y + 1;
      doc.font(F_REG()).fontSize(8).fillColor('#000000');
      if (faculdade.cnpj) {
        doc.text(
          `CNPJ ${faculdade.cnpj}${faculdade.email ? ' / E-mail.: ' + faculdade.email : ''}${faculdade.telefone ? ' ' + faculdade.telefone : ''}`,
          MARGEM, y, { width: utilizavel, align: 'center' }
        );
        y = doc.y;
      }
      if (faculdade.endereco) {
        doc.text(`ENDEREÇO: ${faculdade.endereco}`, MARGEM, y, { width: utilizavel, align: 'center' });
        y = doc.y;
      }
    }
    // linha separadora
    y += 4;
    doc.moveTo(MARGEM, y).lineTo(larguraPagina - MARGEM, y).lineWidth(1).strokeColor('#000000').stroke();
    return y + 6;
  }

  estado.y = desenharCabecalho();

  function novaPagina(): number {
    doc.addPage();
    estado.y = desenharCabecalho();
    return estado.y;
  }

  function garantirEspaco(altura: number): void {
    if (estado.y + altura > bottomLimit) estado.y = novaPagina();
  }

  // ===== CAIXA DE DADOS DO ALUNO (4 colunas) =====
  const cursoNome = cursoInfo?.nome || aluno.curso || '—';
  const turnoV = cursoInfo?.turno || aluno.turno || '—';
  const regulatorio = cursoInfo?.regulatory || '—';

  const linhasDados: { label: string; valor: string; span?: number }[][] = [
    [
      { label: 'CGA', valor: aluno.matricula || '—' },
      { label: 'NOME DO ALUNO', valor: aluno.nome, span: 2 },
      { label: 'SEXO', valor: aluno.sexo || '—' },
    ],
    [
      { label: 'DATA DE NASC', valor: formatarData(aluno.data_nascimento) },
      { label: 'NATURALIDADE', valor: aluno.naturalidade || '—' },
      { label: 'CIDADE', valor: aluno.cidade ? `${aluno.cidade}${aluno.naturalidade ? '-' + aluno.naturalidade : ''}` : (aluno.naturalidade ? aluno.naturalidade : '—') },
      { label: 'RG', valor: aluno.rg || '—' },
    ],
    [
      { label: 'ORGÃO EMISSOR', valor: aluno.orgao_emissor || '—' },
      { label: 'CPF', valor: aluno.cpf || '—' },
      { label: 'CURSO', valor: cursoNome, span: 2 },
    ],
    [
      { label: 'TURNO', valor: turnoV },
      { label: 'REGULATÓRIO', valor: regulatorio, span: 3 },
    ],
    [
      { label: 'COD. EMEC', valor: cursoInfo?.codEmec || '—' },
      { label: 'FORMA DE INGRESSO', valor: aluno.forma_ingresso || 'Vestibular' },
      { label: 'DATA VESTIBULAR', valor: formatarData(aluno.data_vestibular) },
      { label: 'SITUAÇÃO ATUAL', valor: situacao },
    ],
    [
      { label: 'DATA DA CONCLUSÃO DO CURSO', valor: aluno.ano_conclusao && aluno.ano_conclusao !== 'Cursando' ? formatarData(aluno.ano_conclusao) : '—', span: 2 },
      { label: 'DATA DA COLAÇÃO DE GRAU', valor: formatarData(aluno.data_colacao), span: 2 },
    ],
  ];

  estado.y = desenharCaixaDados(doc, MARGEM, estado.y, utilizavel, linhasDados, () => novaPagina(), bottomLimit);
  garantirEspaco(16);

  if (faculdade.enade) {
    doc.font(F_BOLD()).fontSize(9).fillColor('#000000');
    doc.text(`ENADE: ${faculdade.enade}`, MARGEM, estado.y, { width: utilizavel });
    estado.y = doc.y + 6;
  }

  // ===== TABELA DE DISCIPLINAS =====
  estado.y = desenharTabelaDisciplinas(doc, MARGEM, estado.y, utilizavel, disciplinas, () => novaPagina(), bottomLimit);

  // ===== TOTAIS =====
  const totalCh = disciplinas.reduce((s, d) => s + parseCh(d.ch), 0);
  const notas = disciplinas.map((d) => parseNota(d.nota)).filter((n): n is number => n !== null);
  const mediaGeral = notas.length ? notas.reduce((s, n) => s + n, 0) / notas.length : 0;

  garantirEspaco(40);
  estado.y += 8;
  doc.font(F_BOLD()).fontSize(10).fillColor('#000000');
  doc.text(`CARGA HORÁRIA TOTAL DO CURSO: ${fmtNum(totalCh)}H`, MARGEM, estado.y, { width: utilizavel });
  estado.y = doc.y + 2;
  doc.text(`MÉDIA GERAL: ${mediaGeral.toFixed(1)}`, MARGEM, estado.y, { width: utilizavel });
  estado.y = doc.y + 6;

  // ===== ASSINATURA =====
  garantirEspaco(100);
  estado.y += 30;
  const centro = larguraPagina / 2;

  // Verifica assinatura ativa (imagem) — aparece independente de certificado
  const assinatura = getAssinaturaAtiva();
  const temCertificado = !!(
    (assinatura?.certificado_path && fs.existsSync(assinatura.certificado_path)) ||
    (assinatura?.certificado_tipo === 'A3' && !!assinatura.certificado_a3_thumbprint)
  );
  const temImagem = !semAssinatura && !!(assinatura?.imagem_path && fs.existsSync(assinatura.imagem_path));
  const nomeAss = assinatura?.nome_signatario || faculdade.diretor || '';
  const cargoAss = assinatura?.cargo || faculdade.cargoDiretor || 'Diretor Geral';

  // Sempre coloca a imagem da assinatura se estiver cadastrada (mesmo sem certificado)
  // A baseline do texto (onde a letra "o" toca) fica EXATAMENTE em cima da linha
  let assH = 0;
  const assW = 238;
  if (assinatura?.imagem_path && fs.existsSync(assinatura.imagem_path)) {
    try {
      const dim = getImageSize(assinatura.imagem_path);
      assH = (dim.height / dim.width) * assW;
    } catch { /* ignora */ }
  }
  const linhaY = estado.y + assH;
  if (temImagem) {
    try {
      const dim = getImageSize(assinatura!.imagem_path!);
      const bounds = getPngContentBounds(assinatura!.imagem_path!);
      const baselineFrac = bounds ? bounds.baseline / dim.height : 1;
      const imageTop = linhaY - baselineFrac * assH + 2.835; // 3mm - 2mm = 1mm
      doc.image(assinatura!.imagem_path!, centro - assW / 2, imageTop, { width: assW });
    } catch { /* ignora erro de imagem */ }
  }
  estado.y = linhaY;
  doc.moveTo(centro - 130, estado.y).lineTo(centro + 130, estado.y).lineWidth(0.7).strokeColor('#000000').stroke();
  doc.font(F_BOLD()).fontSize(10).fillColor('#000000');
  doc.text(nomeAss, centro - 130, estado.y + 3, { width: 260, align: 'center' });
  doc.font(F_REG()).fontSize(9);
  doc.text(cargoAss, centro - 130, doc.y, { width: 260, align: 'center' });
  // Indica se tem certificado digital
  if (temCertificado) {
    doc.font(F_REG()).fontSize(7).fillColor('#666666');
    doc.text('Documento assinado digitalmente com certificado ICP-Brasil', centro - 130, doc.y, { width: 260, align: 'center' });
  }
  estado.y = doc.y + 8;

  // ===== QR + VERIFICAÇÃO =====
  if (qrBuffer) {
    garantirEspaco(70);
    const qrSize = 60;
    const qrX = centro - qrSize / 2;
    try {
      doc.image(qrBuffer, qrX, estado.y, { width: qrSize, height: qrSize });
    } catch {
      /* ignora */
    }
    doc.font(F_REG()).fontSize(7).fillColor('#000000');
    doc.text(`Código de verificação: ${codigoVerificacao}`,
      MARGEM,
      estado.y + qrSize + 2,
      { width: utilizavel, align: 'center' }
    );
    doc.text(textoInstrucaoQr(urlVerificacao), MARGEM, doc.y, { width: utilizavel, align: 'center' });
  }

  // ===== EMISSÃO (horário de Brasília) =====
  garantirEspaco(20);
  estado.y += 8;
  doc.font(F_REG()).fontSize(8).fillColor('#000000');
  doc.text(
    `Emitido em ${formatarDataHoraBrasilia(emitidoEm)} (horário de Brasília)`,
    MARGEM,
    estado.y,
    { width: utilizavel, align: 'center' }
  );
  estado.y = doc.y;

  // ===== RODAPÉ =====
  if (faculdade.rodape) {
    doc.y = doc.page.height - 26;
    doc.font(F_REG()).fontSize(6.5).fillColor('#000000');
    doc.text(faculdade.rodape, MARGEM, doc.y, { width: utilizavel, align: 'center' });
  }

  return new Promise<void>((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.end();
  });
}

const CH_TOTAL_EXIGIDA_ENG_MEC = 3920;
const TITULO_OBTIDO_ENG_MEC = 'Bacharelado';
const OBSERVACOES_ENG_MEC =
  'Declaro que o aluno acima mencionado cursou com aprovação todas as disciplinas obrigatórias, integralizou a carga horária total exigida e demais exigências para conclusão do Curso de Bacharelado em Engenharia de Produção Mecânica, conforme grade curricular do curso.';

function renderHistoricoEngMecPdf(opts: RenderOpts): Promise<void> {
  const { aluno, disciplinas, faculdade, cursoInfo, destinoPath, codigoVerificacao, qrBuffer, semAssinatura, emitidoEm, urlVerificacao } = opts;

  const MARG = 40;
  const doc = new PDFDocument({ size: 'A4', margin: MARG, layout: 'portrait' });
  const stream = fs.createWriteStream(destinoPath);
  stream.on('error', () => {});
  doc.pipe(stream);
  registrarFontes(doc);

  const larguraPagina = doc.page.width;
  const alturaPagina = doc.page.height;
  const utilizavel = larguraPagina - MARG * 2;
  const bottomLimit = alturaPagina - 50;

  const COL_RATIOS = [45, 165, 118, 60, 28, 24, 30, 45];
  const totalRatio = COL_RATIOS.reduce((a, b) => a + b, 0);
  const colLarguras = COL_RATIOS.map((r) => (r / totalRatio) * utilizavel);
  const COL_HEADERS = ['Período', 'Componentes Curriculares', 'Docente', 'Titulação', 'CH', 'FT', 'Nota', 'Situação'];
  const ALT_LINHA = 14;
  const ALT_SEMESTRE = 15;
  const ALT_HEADER_TABELA = 16;

  // coluna direita do cabeçalho (título + pág.)
  const colEsqW = utilizavel * 0.62;
  const colDirX = MARG + colEsqW + 10;
  const colDirW = utilizavel - colEsqW - 10;
  const PAG_NUM_Y = MARG + 16;

  // agrupa por período ordenado → ordem do semestre (1º, 2º, ...)
  const periodosOrd = Array.from(new Set(disciplinas.map((d) => d.periodo))).sort();
  const grupos = periodosOrd.map((p, idx) => ({
    ordem: idx + 1,
    periodo: p,
    discs: disciplinas.filter((d) => d.periodo === p),
  }));

  let y = MARG;

  function cabecalho(): number {
    let yy = MARG;
    doc.font(F_BOLD()).fontSize(11).fillColor('#000000');
    doc.text(faculdade.nome, MARG, yy, { width: colEsqW });
    yy = doc.y + 1;
    if (faculdade.registroRtd) {
      doc.font(F_REG()).fontSize(7.5).fillColor('#000000');
      doc.text(faculdade.registroRtd, MARG, yy, { width: colEsqW });
      yy = doc.y;
    }
    doc.font(F_BOLD()).fontSize(12).fillColor('#000000');
    doc.text('Histórico Escolar', colDirX, MARG, { width: colDirW, align: 'right' });
    yy = Math.max(yy, doc.y);
    yy += 6;
    doc.font(F_BOLD()).fontSize(13).fillColor('#000000');
    doc.text('HISTÓRICO ESCOLAR', MARG, yy, { width: utilizavel, align: 'center' });
    yy = doc.y + 4;
    doc.moveTo(MARG, yy).lineTo(MARG + utilizavel, yy).lineWidth(1).strokeColor('#000000').stroke();
    return yy + 8;
  }

  function dadosAluno(yIn: number): number {
    let yy = yIn;
    const ALT = 16;
    const rows: { label: string; valor: string; w: number }[][] = [
      [
        { label: 'Aluno(a):', valor: aluno.nome || '—', w: 0.62 },
        { label: 'CPF:', valor: aluno.cpf || '—', w: 0.38 },
      ],
      [
        { label: 'Matrícula:', valor: aluno.matricula || '—', w: 1 / 3 },
        { label: 'Data de Nascimento:', valor: formatarData(aluno.data_nascimento), w: 1 / 3 },
        { label: 'Sexo:', valor: aluno.sexo || '—', w: 1 / 3 },
      ],
      [
        { label: 'Nacionalidade:', valor: aluno.nacionalidade || '—', w: 1 / 3 },
        { label: 'R.G.:', valor: aluno.rg || '—', w: 1 / 3 },
        { label: 'Naturalidade:', valor: aluno.naturalidade || '—', w: 1 / 3 },
      ],
    ];
    for (const row of rows) {
      let cx = MARG;
      for (const f of row) {
        const fw = utilizavel * f.w;
        doc.save();
        doc.rect(cx, yy, fw, ALT).lineWidth(0.4).strokeColor('#000000').stroke();
        doc.restore();
        doc.font(F_BOLD()).fontSize(7.5).fillColor('#000000');
        const lblW = doc.widthOfString(f.label);
        doc.text(f.label, cx + 3, yy + 4.5, { width: fw - 6 });
        doc.font(F_REG()).fontSize(9).fillColor('#000000');
        doc.text(f.valor, cx + 3 + lblW + 2, yy + 4.5, { width: fw - 6 - lblW - 2 });
        cx += fw;
      }
      yy += ALT;
    }
    return yy + 6;
  }

  function infoCurso(yIn: number): number {
    let yy = yIn;
    doc.font(F_BOLD()).fontSize(9).fillColor('#000000');
    doc.text('Informação do Curso', MARG, yy, { width: utilizavel });
    yy = doc.y + 2;
    const top = yy;
    const cursoNome = cursoInfo?.nome || aluno.curso || '—';
    const regulatorio = cursoInfo?.regulatory || '—';
    const situacao = !aluno.ano_conclusao ? '—' : aluno.ano_conclusao === 'Cursando' ? 'CURSANDO' : 'GRADUADO';
    const ingresso = aluno.forma_ingresso || 'Vestibular';
    const pad = 4;

    doc.font(F_BOLD()).fontSize(8.5).fillColor('#000000');
    doc.text('Curso:', MARG + pad, yy, { width: utilizavel - pad * 2 });
    const lwC = doc.widthOfString('Curso:');
    doc.font(F_REG()).fontSize(8.5);
    doc.text(cursoNome, MARG + pad + lwC + 3, yy, { width: utilizavel - pad * 2 - lwC - 3 });
    yy = Math.max(doc.y, yy + 12) + 2;

    doc.font(F_BOLD()).fontSize(8.5);
    doc.text('Autorização do Curso:', MARG + pad, yy, { width: utilizavel - pad * 2 });
    const lwA = doc.widthOfString('Autorização do Curso:');
    doc.font(F_REG()).fontSize(8.5);
    doc.text(regulatorio, MARG + pad + lwA + 3, yy, { width: utilizavel - pad * 2 - lwA - 3 });
    yy = Math.max(doc.y, yy + 12) + 2;

    const metade = utilizavel / 2;
    doc.font(F_BOLD()).fontSize(8.5);
    doc.text('Forma de Ingresso:', MARG + pad, yy, { width: metade - pad });
    const lwF = doc.widthOfString('Forma de Ingresso:');
    doc.font(F_REG()).fontSize(8.5);
    doc.text(ingresso, MARG + pad + lwF + 3, yy, { width: metade - pad - lwF - 3 });
    doc.font(F_BOLD()).fontSize(8.5);
    doc.text('Situação Atual:', MARG + metade, yy, { width: metade - pad });
    const lwS = doc.widthOfString('Situação Atual:');
    doc.font(F_REG()).fontSize(8.5);
    doc.text(situacao, MARG + metade + lwS + 3, yy, { width: metade - pad - lwS - 3 });
    yy += 14;

    doc.rect(MARG, top, utilizavel, yy - top).lineWidth(0.5).strokeColor('#000000').stroke();
    return yy + 8;
  }

  function topoPagina(): number {
    let yy = cabecalho();
    yy = dadosAluno(yy);
    yy = infoCurso(yy);
    return yy;
  }

  y = topoPagina();
  function novaPagina(): number {
    doc.addPage();
    return topoPagina();
  }
  function garantir(alt: number): void {
    if (y + alt > bottomLimit) y = novaPagina();
  }

  // ===== TABELA =====
  garantir(ALT_HEADER_TABELA);
  doc.save();
  doc.rect(MARG, y, utilizavel, ALT_HEADER_TABELA).fillAndStroke('#000000', '#000000');
  doc.font(F_BOLD()).fontSize(7.5).fillColor('#ffffff');
  let cxh = MARG;
  for (let i = 0; i < COL_HEADERS.length; i++) {
    doc.text(COL_HEADERS[i], cxh + 2, y + 5, { width: colLarguras[i] - 4 });
    cxh += colLarguras[i];
  }
  doc.restore();
  y += ALT_HEADER_TABELA;

  for (const g of grupos) {
    garantir(ALT_SEMESTRE);
    doc.save();
    doc.rect(MARG, y, utilizavel, ALT_SEMESTRE).fillAndStroke('#e8e8e8', '#000000');
    doc.font(F_BOLD()).fontSize(8).fillColor('#000000');
    doc.text(`${g.ordem}º Semestre`, MARG + 3, y + 4, { width: utilizavel - 6 });
    doc.restore();
    y += ALT_SEMESTRE;

    for (const d of g.discs) {
      garantir(ALT_LINHA);
      doc.save();
      doc.rect(MARG, y, utilizavel, ALT_LINHA).lineWidth(0.3).strokeColor('#000000').stroke();
      const celulas = [
        g.periodo,
        (d.disciplina || '').toUpperCase(),
        formatarNome(d.docente || ''),
        formatarNome(d.titulacao || ''),
        d.ch || '',
        d.ft || '',
        d.nota || '',
        d.status || '',
      ];
      let ccx = MARG;
      for (let i = 0; i < celulas.length; i++) {
        doc.font(i === 0 ? F_BOLD() : F_REG()).fontSize(7).fillColor('#000000');
        doc.text(celulas[i], ccx + 2, y + 4.5, { width: colLarguras[i] - 4 });
        ccx += colLarguras[i];
      }
      doc.restore();
      y += ALT_LINHA;
    }
  }

  // ===== BLOCO FINAL =====
  // ENADE
  garantir(16);
  doc.font(F_REG()).fontSize(8.5).fillColor('#000000');
  doc.text(`Exame Nacional: ${faculdade.enade || '—'}`, MARG, y, { width: utilizavel });
  y = doc.y + 10;

  // resumo de carga horária
  const chAtividades = disciplinas
    .filter((d) => (d.disciplina || '').toUpperCase().includes('ATIVIDADES COMPLEMENTARES'))
    .reduce((s, d) => s + parseCh(d.ch), 0);
  const chTotalGeral = disciplinas.reduce((s, d) => s + parseCh(d.ch), 0);
  const chDisciplinas = chTotalGeral - chAtividades;
  let crNum = 0;
  let crPeso = 0;
  for (const d of disciplinas) {
    const n = parseNota(d.nota);
    const c = parseCh(d.ch);
    if (n !== null && c > 0) {
      crNum += n * c;
      crPeso += c;
    }
  }
  const cr = crPeso > 0 ? (crNum / crPeso).toFixed(2).replace('.', ',') : '—';
  const resumo: [string, string][] = [
    ['CH Disciplinas Cursadas', fmtNum(chDisciplinas)],
    ['CH Atividades Complementares', fmtNum(chAtividades)],
    ['CH Total Cursada', fmtNum(chTotalGeral)],
    ['CH Total Exigida', fmtNum(CH_TOTAL_EXIGIDA_ENG_MEC)],
    ['Coeficiente de Rendimento', cr],
  ];

  garantir(85);
  const resumoW = utilizavel * 0.5;
  const resumoX = MARG + utilizavel - resumoW;
  let ry = y;
  for (const [lbl, val] of resumo) {
    doc.save();
    doc.rect(resumoX, ry, resumoW, 15).lineWidth(0.4).strokeColor('#000000').stroke();
    doc.rect(resumoX, ry, resumoW * 0.7, 15).lineWidth(0.4).strokeColor('#000000').stroke();
    doc.font(F_REG()).fontSize(8).fillColor('#000000');
    doc.text(lbl, resumoX + 3, ry + 4.5, { width: resumoW * 0.7 - 6 });
    doc.font(F_BOLD()).fontSize(8);
    doc.text(val, resumoX + resumoW * 0.7 + 2, ry + 4.5, { width: resumoW * 0.3 - 4, align: 'right' });
    doc.restore();
    ry += 15;
  }
  y = ry + 8;

  // observações
  garantir(70);
  doc.font(F_BOLD()).fontSize(9).fillColor('#000000');
  doc.text('Observações', MARG, y, { width: utilizavel });
  y = doc.y + 2;
  doc.font(F_REG()).fontSize(8.5).fillColor('#000000');
  doc.text(OBSERVACOES_ENG_MEC, MARG, y, { width: utilizavel, align: 'justify' });
  y = doc.y + 6;
  const situacaoObs = !aluno.ano_conclusao ? '—' : aluno.ano_conclusao === 'Cursando' ? 'Cursando' : 'Formado';
  const dataConclusao = aluno.ano_conclusao && aluno.ano_conclusao !== 'Cursando' ? formatarData(aluno.ano_conclusao) : '';
  const dataColacao = formatarData(aluno.data_colacao);
  doc.font(F_REG()).fontSize(8.5);
  doc.text(`Status: ${situacaoObs}`, MARG, y, { width: utilizavel });
  y = doc.y + 2;
  doc.text(`Data da Conclusão do Curso: ${dataConclusao || '_________________________'}`, MARG, y, { width: utilizavel });
  y = doc.y + 2;
  doc.text(`Data de Colação de Grau: ${dataColacao || '_________________________'}`, MARG, y, { width: utilizavel });
  y = doc.y + 2;
  doc.text(`Título Obtido: ${TITULO_OBTIDO_ENG_MEC}`, MARG, y, { width: utilizavel });
  y = doc.y + 14;

  // assinatura (imagem da assinatura ativa)
  garantir(70);
  const centro = larguraPagina / 2;
  const assinatura = getAssinaturaAtiva();
  const temImagem = !semAssinatura && !!(assinatura?.imagem_path && fs.existsSync(assinatura.imagem_path));
  const nomeAss = assinatura?.nome_signatario || faculdade.diretor || '';
  const cargoAss = assinatura?.cargo || faculdade.cargoDiretor || 'Diretor Geral';
  let assH = 0;
  const assW = 220;
  if (temImagem) {
    try {
      const dim = getImageSize(assinatura!.imagem_path!);
      assH = (dim.height / dim.width) * assW;
    } catch { /* ignora */ }
  }
  const linhaY = y + assH + 6;
  if (temImagem) {
    try {
      const dim = getImageSize(assinatura!.imagem_path!);
      const bounds = getPngContentBounds(assinatura!.imagem_path!);
      const baselineFrac = bounds ? bounds.baseline / dim.height : 1;
      const imageTop = linhaY - baselineFrac * assH + 2.835;
      doc.image(assinatura!.imagem_path!, centro - assW / 2, imageTop, { width: assW });
    } catch { /* ignora */ }
  }
  doc.moveTo(centro - 120, linhaY).lineTo(centro + 120, linhaY).lineWidth(0.7).strokeColor('#000000').stroke();
  doc.font(F_BOLD()).fontSize(9.5).fillColor('#000000');
  doc.text(nomeAss, centro - 120, linhaY + 3, { width: 240, align: 'center' });
  doc.font(F_REG()).fontSize(8.5);
  doc.text(cargoAss, centro - 120, doc.y, { width: 240, align: 'center' });
  y = doc.y + 14;

  // QR + verificação
  if (qrBuffer) {
    garantir(80);
    const qrSize = 55;
    try {
      doc.image(qrBuffer, centro - qrSize / 2, y, { width: qrSize, height: qrSize });
    } catch { /* ignora */ }
    doc.font(F_REG()).fontSize(7).fillColor('#000000');
    doc.text(`Código de verificação: ${codigoVerificacao}`, MARG, y + qrSize + 2, { width: utilizavel, align: 'center' });
    doc.text(textoInstrucaoQr(urlVerificacao), MARG, doc.y, { width: utilizavel, align: 'center' });
    y = doc.y + 4;
  }

  // emissão
  doc.font(F_REG()).fontSize(7.5).fillColor('#000000');
  doc.text(`Emitido em ${formatarDataHoraBrasilia(emitidoEm)} (horário de Brasília)`, MARG, y, { width: utilizavel, align: 'center' });

  // rodapé (última página)
  if (faculdade.rodape) {
    doc.font(F_REG()).fontSize(6.5).fillColor('#000000');
    doc.text(faculdade.rodape, MARG, alturaPagina - 32, { width: utilizavel, align: 'center' });
  }

  // ===== PAGE NUMBERS (X/Y) — stamp no final =====
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = range.start; i < range.start + total; i++) {
    doc.switchToPage(i);
    doc.font(F_REG()).fontSize(8).fillColor('#000000');
    doc.text(`Pág. ${i - range.start + 1}/${total}`, colDirX, PAG_NUM_Y, { width: colDirW, align: 'right' });
  }

  return new Promise<void>((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.end();
  });
}

interface CelulaDados {
  label: string;
  valor: string;
  span?: number;
}

function desenharCaixaDados(
  doc: PDFKit.PDFDocument,
  x: number,
  yIn: number,
  largura: number,
  linhas: CelulaDados[][],
  novaPagina: () => number,
  bottomLimit: number
): number {
  const PAD = 4;
  let y = yIn;

  for (const linha of linhas) {
    // calcula larguras considerando span
    const spans = linha.map((c) => c.span ?? 1);
    const totalSpan = spans.reduce((a, b) => a + b, 0);
    const unidade = largura / totalSpan;
    const celW = linha.map((c) => unidade * (c.span ?? 1));

    // altura necessária (mede valor wrapped)
    doc.font(F_REG()).fontSize(9);
    const alturas = linha.map((c, i) => {
      const w = celW[i] - PAD * 2;
      const hValor = doc.heightOfString(c.valor || '—', {
        width: Math.max(w, 10),
        lineGap: 0,
      });
      return hValor + 14; // label + padding
    });
    const rowH = Math.max(...alturas);

    // quebra de página se necessário
    if (y + rowH > bottomLimit) {
      y = novaPagina();
    }

    // fundo e bordas
    let cx = x;
    doc.save();
    for (let i = 0; i < linha.length; i++) {
      doc.rect(cx, y, celW[i], rowH).lineWidth(0.5).strokeColor('#000000').stroke();
      cx += celW[i];
    }
    doc.restore();

    // textos
    cx = x;
    for (let i = 0; i < linha.length; i++) {
      const c = linha[i];
      const w = celW[i] - PAD * 2;
      doc.font(F_BOLD()).fontSize(7).fillColor('#000000');
      doc.text(c.label, cx + PAD, y + 3, { width: w });
      doc.font(F_REG()).fontSize(9).fillColor('#000000');
      doc.text(c.valor || '—', cx + PAD, y + 11, { width: w });
      cx += celW[i];
    }

    y += rowH;
  }
  return y + 4;
}

function desenharTabelaDisciplinas(
  doc: PDFKit.PDFDocument,
  x: number,
  yIn: number,
  largura: number,
  disciplinas: HistoricoDisciplina[],
  novaPagina: () => number,
  bottomLimit: number
): number {
  const alturaHeader = 16;
  const alturaLinha = 14;
  let y = yIn;

  // agrupa por periodo
  const periodos = new Map<string, HistoricoDisciplina[]>();
  for (const d of disciplinas) {
    if (!periodos.has(d.periodo)) periodos.set(d.periodo, []);
    periodos.get(d.periodo)!.push(d);
  }

  // cabeçalho da tabela
  if (y + alturaHeader > bottomLimit) {
    y = novaPagina();
  }
  doc.save();
  doc.rect(x, y, largura, alturaHeader).fillAndStroke('#000000', '#000000');
  doc.font(F_BOLD()).fontSize(8).fillColor('#ffffff');
  let cx = x;
  for (const col of COLUNAS) {
    doc.text(col.titulo, cx + 3, y + 4, { width: col.largura - 6 });
    cx += col.largura;
  }
  doc.restore();
  y += alturaHeader;

  for (const [periodo, discs] of periodos) {
    for (let i = 0; i < discs.length; i++) {
      const d = discs[i];
      if (y + alturaLinha > bottomLimit) {
        y = novaPagina();
      }
      const isPrimeira = i === 0;
      doc.save();
      // célula período destacada na primeira linha do grupo
      if (isPrimeira) {
        doc.rect(x, y, COLUNAS[0].largura, discs.length * alturaLinha).fillAndStroke('#f0f0f0', '#000000');
      }
      doc.rect(x, y, largura, 0).lineWidth(0.3).strokeColor('#000000');

      let ccx = x;
      doc.font(F_BOLD()).fontSize(8).fillColor('#000000');
      doc.text(isPrimeira ? periodo : '', ccx + 3, y + 3, { width: COLUNAS[0].largura - 6 });
      ccx += COLUNAS[0].largura;
      doc.font(F_REG()).fontSize(8);
      doc.text(formatarNome(d.disciplina || ''), ccx + 3, y + 3, { width: COLUNAS[1].largura - 6 });
      ccx += COLUNAS[1].largura;
      doc.text(formatarNome(d.docente || ''), ccx + 3, y + 3, { width: COLUNAS[2].largura - 6 });
      ccx += COLUNAS[2].largura;
      doc.text(d.titulacao || '', ccx + 3, y + 3, { width: COLUNAS[3].largura - 6 });
      ccx += COLUNAS[3].largura;
      doc.text(d.ch || '', ccx + 3, y + 3, { width: COLUNAS[4].largura - 6 });
      ccx += COLUNAS[4].largura;
      doc.text(d.nota || '', ccx + 3, y + 3, { width: COLUNAS[5].largura - 6 });
      ccx += COLUNAS[5].largura;
      doc.text(d.status || '', ccx + 3, y + 3, { width: COLUNAS[6].largura - 6 });
      doc.restore();
      y += alturaLinha;
    }

    // totais do período
    if (y + alturaLinha > bottomLimit) {
      y = novaPagina();
    }
    const chPeriodo = discs.reduce((s, d) => s + parseCh(d.ch), 0);
    doc.save();
    doc.rect(x, y, largura, alturaLinha).fillAndStroke('#000000', '#000000');
    doc.font(F_BOLD()).fontSize(8).fillColor('#ffffff');
    const offsetTotais = COLUNAS[0].largura + COLUNAS[1].largura + COLUNAS[2].largura + COLUNAS[3].largura;
    doc.text('TOTAIS DO PERÍODO', x + COLUNAS[0].largura + 3, y + 3, {
      width: offsetTotais - COLUNAS[0].largura - 6,
    });
    doc.text(`${fmtNum(chPeriodo)}H`, x + offsetTotais + 3, y + 3, { width: COLUNAS[4].largura - 6 });
    doc.restore();
    y += alturaLinha;
  }

  // borda externa
  doc.rect(x, yIn, largura, y - yIn).lineWidth(0.5).strokeColor('#000000').stroke();
  return y + 6;
}

function mover(_event: IpcMainInvokeEvent, id: number, direcao: 'up' | 'down'): ApiResult<true> {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM historico_disciplinas WHERE id = ?').get(id) as HistoricoDisciplina | undefined;
  if (!atual) return { ok: false, error: 'Disciplina não encontrada' };

  // encontra a disciplina adjacente no mesmo período
  const vizinho =
    direcao === 'up'
      ? db.prepare(
          'SELECT * FROM historico_disciplinas WHERE aluno_id = ? AND periodo = ? AND ordem < ? ORDER BY ordem DESC LIMIT 1'
        ).get(atual.aluno_id, atual.periodo, atual.ordem) as HistoricoDisciplina | undefined
      : db.prepare(
          'SELECT * FROM historico_disciplinas WHERE aluno_id = ? AND periodo = ? AND ordem > ? ORDER BY ordem ASC LIMIT 1'
        ).get(atual.aluno_id, atual.periodo, atual.ordem) as HistoricoDisciplina | undefined;

  if (!vizinho) return { ok: false, error: 'Não há disciplina para mover nesta direção' };

  // troca as ordens
  db.prepare('UPDATE historico_disciplinas SET ordem = ? WHERE id = ?').run(vizinho.ordem, atual.id);
  db.prepare('UPDATE historico_disciplinas SET ordem = ? WHERE id = ?').run(atual.ordem, vizinho.id);

  return { ok: true, data: true };
}

function escapeXml(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function gerarXmlHistorico(
  event: IpcMainInvokeEvent,
  alunoId: number,
  senhaPfx?: string
): Promise<ApiResult<{ xmlPath: string; aviso?: string }>> {
  const sessao = getSessao();
  if (!sessao) return { ok: false, error: 'Não autenticado' };

  const db = getDb();
  const aluno = db.prepare('SELECT * FROM alunos WHERE id = ?').get(alunoId) as Aluno | undefined;
  if (!aluno) return { ok: false, error: 'Aluno não encontrado' };

  const disciplinas = db
    .prepare('SELECT * FROM historico_disciplinas WHERE aluno_id = ? ORDER BY periodo ASC, ordem ASC, id ASC')
    .all(alunoId) as HistoricoDisciplina[];

  if (disciplinas.length === 0) {
    return { ok: false, error: 'Este aluno não possui disciplinas no histórico.' };
  }

  const info = getFaculdadeInfo(aluno.faculdade);
  const cursoInfo = (aluno.curso && info.cursos[aluno.curso]) || null;
  const e = escapeXml;
  const totalCh = disciplinas.reduce((s, d) => {
    const n = parseInt((d.ch ?? '').replace(/\D/g, '') || '0', 10);
    return s + (isNaN(n) ? 0 : n);
  }, 0);
  const notas = disciplinas.map((d) => parseFloat((d.nota ?? '').replace(',', '.'))).filter((n) => !isNaN(n));
  const media = notas.length ? (notas.reduce((s, n) => s + n, 0) / notas.length).toFixed(1) : '0.0';

  // agrupa por período
  const periodos: Record<string, HistoricoDisciplina[]> = {};
  for (const d of disciplinas) {
    if (!periodos[d.periodo]) periodos[d.periodo] = [];
    periodos[d.periodo].push(d);
  }

  let conteudoPeriodos = '';
  for (const [periodo, discs] of Object.entries(periodos)) {
    conteudoPeriodos += `    <periodo numero="${e(periodo)}">\n`;
    for (const d of discs) {
      conteudoPeriodos += `      <disciplina>\n`;
      conteudoPeriodos += `        <nome>${e(formatarNome(d.disciplina))}</nome>\n`;
      conteudoPeriodos += `        <docente>${e(formatarNome(d.docente || ''))}</docente>\n`;
      conteudoPeriodos += `        <titulacao>${e(d.titulacao || '')}</titulacao>\n`;
      conteudoPeriodos += `        <cargaHoraria>${e(d.ch || '')}</cargaHoraria>\n`;
      conteudoPeriodos += `        <nota>${e(d.nota || '')}</nota>\n`;
      conteudoPeriodos += `        <faltas>${e(d.ft || '')}</faltas>\n`;
      conteudoPeriodos += `        <status>${e(d.status || '')}</status>\n`;
      conteudoPeriodos += `      </disciplina>\n`;
    }
    const chPer = discs.reduce((s, d) => {
      const n = parseInt((d.ch ?? '').replace(/\D/g, '') || '0', 10);
      return s + (isNaN(n) ? 0 : n);
    }, 0);
    conteudoPeriodos += `      <totalPeriodo cargaHoraria="${chPer}H" />\n`;
    conteudoPeriodos += `    </periodo>\n`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<historicoAcademico xmlns="https://nexa-class.edu/historico">
  <cabecalho>
    <sistema>NEXA CLASS</sistema>
    <geradoEm>${new Date().toISOString()}</geradoEm>
    <instituicao>${e(info.nome)}</instituicao>
    <cnpj>${e(info.cnpj)}</cnpj>
  </cabecalho>
  <aluno>
    <nome>${e(aluno.nome)}</nome>
    <matricula>${e(aluno.matricula)}</matricula>
    <cpf>${e(aluno.cpf || '')}</cpf>
    <rg>${e(aluno.rg || '')}</rg>
    <orgaoEmissor>${e(aluno.orgao_emissor || '')}</orgaoEmissor>
    <sexo>${e(aluno.sexo || '')}</sexo>
    <dataNascimento>${e(formatarData(aluno.data_nascimento))}</dataNascimento>
    <naturalidade>${e(aluno.naturalidade || '')}</naturalidade>
    <cidade>${e(aluno.cidade || '')}</cidade>
    <nacionalidade>${e(aluno.nacionalidade || '')}</nacionalidade>
    <curso>${e(cursoInfo?.nome || aluno.curso || '')}</curso>
    <codEmec>${e(cursoInfo?.codEmec || '')}</codEmec>
    <turno>${e(cursoInfo?.turno || aluno.turno || '')}</turno>
    <formaIngresso>${e(aluno.forma_ingresso || 'Vestibular')}</formaIngresso>
    <situacao>${!aluno.ano_conclusao ? '' : aluno.ano_conclusao === 'Cursando' ? 'CURSANDO' : 'GRADUADO'}</situacao>
    <dataConclusao>${e(aluno.ano_conclusao && aluno.ano_conclusao !== 'Cursando' ? aluno.ano_conclusao : '')}</dataConclusao>
    <dataColacao>${e(formatarData(aluno.data_colacao))}</dataColacao>
  </aluno>
  <resumo>
    <cargaHorariaTotal>${totalCh}</cargaHorariaTotal>
    <mediaGeral>${media}</mediaGeral>
    <totalDisciplinas>${disciplinas.length}</totalDisciplinas>
    <totalPeriodos>${Object.keys(periodos).length}</totalPeriodos>
  </resumo>
  <periodos>
${conteudoPeriodos}  </periodos>
</historicoAcademico>
`;

  const win = BrowserWindow.fromWebContents(event.sender);
  const nomeArquivo = montarNomeArquivo('historico', aluno.nome, aluno.matricula || String(aluno.id), aluno.id, 'xml');
  const destino = win
    ? await dialog.showSaveDialog(win, {
        title: 'Salvar Histórico XML',
        defaultPath: nomeArquivo,
        filters: [{ name: 'XML', extensions: ['xml'] }],
      })
    : { canceled: true, filePath: '' };

  if (destino.canceled || !destino.filePath) {
    return { ok: false, error: 'Operação cancelada' };
  }

  // XMLDSig: assina o XML quando há certificado ativo (A1 = senha; A3 = PIN pelo driver).
  let xmlFinal = xml;
  const ass = getAssinaturaAtiva();
  const temCert =
    ass &&
    ((ass.certificado_tipo === 'A3' && !!ass.certificado_a3_thumbprint) ||
      (ass.certificado_path && fs.existsSync(ass.certificado_path)));
  if (temCert) {
    const assinado = await assinarXml(xml, senhaPfx || '');
    if (!assinado.ok || !assinado.xml) {
      return { ok: false, error: assinado.error ?? 'Falha ao assinar o XML.' };
    }
    xmlFinal = assinado.xml;
  }

  const gravado = gravarArquivoSeguro(
    destino.filePath,
    xmlFinal,
    path.join(app.getPath('userData'), 'xml'),
    nomeArquivo
  );
  if (!gravado.ok) {
    logger.warn({ destino: destino.filePath, erro: gravado.erro }, 'Falha ao gravar XML do histórico');
    return { ok: false, error: gravado.erro };
  }
  if (gravado.usouFallback) {
    logger.warn({ destino: destino.filePath, fallback: gravado.caminho }, 'Pasta de destino bloqueada — XML do histórico salvo em fallback');
  }
  return {
    ok: true,
    data: {
      xmlPath: gravado.caminho,
      aviso: gravado.usouFallback
        ? `A pasta escolhida está bloqueada (permissão/OneDrive/antivírus). O arquivo foi salvo em: ${gravado.caminho}`
        : undefined,
    },
  };
}

export function registrarHistoricoHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.HISTORICO_LISTAR, requerAuth(listar));
  ipcMain.handle(IPC_CHANNELS.HISTORICO_CRIAR, requerAuth(criar));
  ipcMain.handle(IPC_CHANNELS.HISTORICO_ATUALIZAR, requerAuth(atualizar));
  ipcMain.handle(IPC_CHANNELS.HISTORICO_EXCLUIR, requerAuth(excluir));
  ipcMain.handle(IPC_CHANNELS.HISTORICO_GERAR_PDF, requerAuth(gerarPdf));
  ipcMain.handle(IPC_CHANNELS.HISTORICO_GERAR_XML, requerAuth(gerarXmlHistorico));
  ipcMain.handle(IPC_CHANNELS.HISTORICO_MOVER, requerAuth(mover));
}
