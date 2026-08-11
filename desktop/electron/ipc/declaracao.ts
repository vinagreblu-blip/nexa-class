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
import type { Aluno, ApiResult, Declaracao, DeclaracaoEmitida, TipoDeclaracao } from '../types';
import { getSessao, requerAuth } from './auth';
import { getAssinaturaAtiva } from './assinatura';
import { gerarUrlValidacao } from '../qr-validador';
import { getImageSize, getPngContentBounds } from '../image-size';
import { gerarHashConteudo, gerarQrPng, formatarDataHoraBrasilia } from '../utils';
import { validarExclusaoDeclaracao } from '../utils/regras';
import { montarNomePdf } from '../utils/sistema';
import { logger } from '../utils/logger';

async function registrarNoWeb(
  codigo: string,
  hash: string,
  aluno: Aluno,
  emitidoEm: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `${CONFIG.VERIFICACAO_BASE_URL.replace(/\/$/, '')}/api/declaracoes`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.VERIFICACAO_API_KEY,
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
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Falha ao contatar o serviço de verificação' };
  }
}

function gerarPdf(opts: {
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
  /** Tipo de declaração — controla título e corpo do texto. */
  tipo?: TipoDeclaracao;
  /** Para tipo='diploma': código e data do diploma referenciado. */
  diplomaReferenciado?: { codigo: string; emitidoEm: string };
}): void {
  const {
    aluno,
    codigo,
    hash,
    qrBuffer,
    emitidoEm,
    destinoPath,
    cursoTexto,
    cargaHorariaTotal,
    faculdadeNome,
    diretor,
    faculdade,
    semAssinatura,
    tipo = 'generico',
    diplomaReferenciado,
  } = opts;

  const doc = new PDFDocument({ size: 'A4', margin: 60 });
  const stream = fs.createWriteStream(destinoPath);
  doc.pipe(stream);

  const largura = doc.page.width;
  const dateFmt = formatarDataHoraBrasilia(emitidoEm);

  // ===== CABEÇALHO DA FACULDADE (com logo) =====
  const logoExiste = faculdade.logoPath && fs.existsSync(faculdade.logoPath);
  if (logoExiste) {
    const logoW = 70;
    const gap = 8;
    try {
      doc.image(faculdade.logoPath!, 60, 60, { width: logoW });
    } catch { /* ignora */ }
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
  } else {
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

  // Título e corpo variam por tipo de declaração.
  const titulo =
    tipo === 'diploma'
      ? 'Declaração de Autenticidade de Diploma'
      : tipo === 'historico'
        ? 'Declaração de Autenticidade de Histórico Escolar'
        : 'Declaração de Autenticidade';

  doc
    .fontSize(12)
    .font('Helvetica-Bold')
    .fillColor('#000000')
    .text(titulo, { align: 'center' });
  doc.moveDown(1.2);

  // Corpo do texto — específico por tipo
  const corpoTexto =
    tipo === 'diploma'
      ? `Declaramos, para os devidos fins, que o Diploma de Conclusão do curso acima identificado, emitido por este sistema${
          diplomaReferenciado
            ? ` em ${formatarDataHoraBrasilia(diplomaReferenciado.emitidoEm)} sob o código de verificação ${diplomaReferenciado.codigo.substring(0, 13)}…`
            : ''
        }, é autêntico e foi expedido em conformidade com os registros acadêmicos oficiais. A autenticidade deste diploma pode ser verificada por meio do QR Code e do código de verificação impressos neste documento.`
      : tipo === 'historico'
        ? `Declaramos, para os devidos fins, que o Histórico Escolar do(a) aluno(a) abaixo identificado(a), referente ao curso acima indicado com carga horária total de ${cargaHorariaTotal.toLocaleString('pt-BR')} horas/aula, é autêntico e foi emitido por este sistema, refletindo com exatidão os registros acadêmicos oficiais. A autenticidade pode ser verificada por meio do código de verificação ou do QR Code impresso neste documento.`
        : 'Declaramos, para os devidos fins, que o documento referente ao(a) aluno(a) abaixo identificado(a) é autêntico e foi emitido por este sistema, podendo ter sua autenticidade verificada por meio do código de verificação ou do QR Code impresso neste documento.';

  doc
    .fillColor('#000000')
    .fontSize(11)
    .font('Helvetica')
    .text(corpoTexto, { align: 'justify', lineGap: 4 });

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

  // Texto de autenticidade (varia por tipo)
  const segundoParagrafo =
    tipo === 'diploma'
      ? `O diploma referenciado foi expedido com base nos registros acadêmicos oficiais da ${faculdadeNome}, em conformidade com a legislação educacional vigente e os atos legais de autorização e reconhecimento do curso junto ao Ministério da Educação (MEC). A presente declaração atesta exclusivamente a autenticidade do diploma identificado acima, podendo ser confirmada a qualquer tempo.`
      : tipo === 'historico'
        ? `O histórico escolar foi expedido com base nos registros acadêmicos oficiais da ${faculdadeNome}, refletindo informações verídicas sobre a trajetória acadêmica do aluno, incluindo disciplinas cursadas, cargas horárias, notas obtidas e data de conclusão do curso.`
        : `O certificado e o histórico escolar apresentados foram emitidos com base nos registros acadêmicos oficiais da ${faculdadeNome}, refletindo informações verídicas sobre a trajetória acadêmica do aluno, incluindo disciplinas cursadas, cargas horárias, notas obtidas e data de conclusão do curso.`;

  doc
    .fillColor('#000000')
    .fontSize(10)
    .font('Helvetica')
    .text(segundoParagrafo, { align: 'justify', lineGap: 3 });
  doc.moveDown(0.6);
  doc.text(
    'Este documento é autêntico e válido, emitido em conformidade com as normas educacionais vigentes e com os atos legais de autorização e reconhecimento do curso registrados junto ao Ministério da Educação (MEC).',
    { align: 'justify', lineGap: 3 }
  );
  doc.moveDown(0.6);

  // Assinatura digital (imagem) se cadastrada
  const assinatura = getAssinaturaAtiva();
  const nomeAss = assinatura?.nome_signatario || diretor;
  const cargoAss = assinatura?.cargo || 'Diretor Geral';
  const temCertificado = !!(
    (assinatura?.certificado_path && fs.existsSync(assinatura.certificado_path)) ||
    (assinatura?.certificado_tipo === 'A3' && !!assinatura.certificado_a3_thumbprint)
  );
  const temImagem = !semAssinatura && !!(assinatura?.imagem_path && fs.existsSync(assinatura.imagem_path));

  doc.moveDown(1);
  const centro = largura / 2;

  // Sempre coloca a imagem da assinatura se estiver cadastrada (mesmo sem certificado)
  // A imagem fica EXATAMENTE em cima da linha (borda inferior = linha)
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
      const imageTop = linhaAss - baselineFrac * assH + 2.835; // 3mm - 2mm = 1mm
      doc.image(assinatura!.imagem_path!, centro - assW / 2, imageTop, { width: assW });
    } catch { /* ignora */ }
  }
  doc.y = linhaAss;
  doc.moveTo(centro - 130, doc.y).lineTo(centro + 130, doc.y).lineWidth(0.7).strokeColor('#000000').stroke();
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000').text(nomeAss, centro - 130, doc.y + 3, { width: 260, align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor('#444444').text(cargoAss, centro - 130, doc.y, { width: 260, align: 'center' });
  if (temCertificado) {
    doc.font('Helvetica').fontSize(7).fillColor('#666666').text('Documento assinado digitalmente com certificado ICP-Brasil', centro - 130, doc.y, { width: 260, align: 'center' });
  }

  doc.moveDown(2);

  doc.font('Helvetica-Bold').fontSize(10).fillColor('#666666').text('EMITIDO EM (HORÁRIO DE BRASÍLIA)', 60);
  doc.font('Helvetica').fillColor('#000000').fontSize(12).text(dateFmt, 60, doc.y + 4);

  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#666666').text('CÓDIGO DE VERIFICAÇÃO', 60);
  doc.font('Courier').fillColor('#000000').fontSize(11).text(codigo, 60, doc.y + 4);

  const qrSize = 99; // 110 - 10%
  const qrX = largura - 60 - qrSize;
  const qrY = doc.y - 30 - 14.175; // -5mm
  doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#666666')
    .text('Escaneie para verificar', qrX, qrY + qrSize + 4, { width: qrSize, align: 'center' });

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

async function emitir(
  event: IpcMainInvokeEvent,
  alunoId: number,
  semAssinatura = false,
  tipo: TipoDeclaracao = 'generico',
  diplomaId?: number
): Promise<ApiResult<DeclaracaoEmitida>> {
  const sessao = getSessao();
  if (!sessao) return { ok: false, error: 'Não autenticado' };

  logger.info({ alunoId, tipo, diplomaId, semAssinatura }, 'Declaração: iniciando emissão');

  const db = getDb();
  const aluno = db.prepare('SELECT * FROM alunos WHERE id = ?').get(alunoId) as Aluno | undefined;
  if (!aluno) return { ok: false, error: 'Aluno não encontrado' };

  // Validação específica por tipo
  let diplomaReferenciado: { codigo: string; emitidoEm: string } | undefined;
  if (tipo === 'diploma') {
    if (!diplomaId) {
      return { ok: false, error: 'Para declaração de diploma, informe o diplomaId do diploma já emitido.' };
    }
    const diploma = db
      .prepare('SELECT id, aluno_id, codigo_verificacao, emitido_em FROM diplomas WHERE id = ?')
      .get(diplomaId) as
      | { id: number; aluno_id: number; codigo_verificacao: string; emitido_em: string }
      | undefined;
    if (!diploma) {
      return { ok: false, error: 'Diploma não encontrado. Emite o diploma antes de emitir a declaração.' };
    }
    if (diploma.aluno_id !== alunoId) {
      return { ok: false, error: 'O diploma informado não pertence ao aluno selecionado.' };
    }
    diplomaReferenciado = {
      codigo: diploma.codigo_verificacao,
      emitidoEm: diploma.emitido_em,
    };
    logger.info({ diplomaId, codigo: diploma.codigo_verificacao }, 'Declaração: diploma referenciado encontrado');
  }

  const codigo = randomUUID();
  const agora = new Date().toISOString();
  const hash = gerarHashConteudo(aluno, agora);

  let info;
  try {
    info = db
      .prepare(
        `INSERT INTO declaracoes (aluno_id, codigo_verificacao, hash_conteudo, emitido_por, tipo, diploma_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(aluno.id, codigo, hash, sessao.usuario.id, tipo, tipo === 'diploma' ? diplomaId : null);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erro ao registrar declaração' };
  }

  const declaracao = db
    .prepare('SELECT * FROM declaracoes WHERE id = ?')
    .get(info.lastInsertRowid) as Declaracao;

  const webResult = await registrarNoWeb(codigo, hash, aluno, agora);
  if (webResult.ok) {
    db.prepare('UPDATE declaracoes SET enviado_web = 1 WHERE id = ?').run(declaracao.id);
    declaracao.enviado_web = 1;
  } else {
    logger.warn({ declaracaoId: declaracao.id, erro: webResult.error }, 'Falha ao enviar declaração para web');
  }

  const win = BrowserWindow.fromWebContents(event.sender);
  const nomeArquivo = montarNomePdf('declaracao', aluno.nome, aluno.matricula, declaracao.id);

  // Salva uma cópia interna em userData/declaracoes/ (para re-download posterior)
  const declaracoesDir = path.join(app.getPath('userData'), 'declaracoes');
  if (!fs.existsSync(declaracoesDir)) fs.mkdirSync(declaracoesDir, { recursive: true });
  const caminhoInterno = path.join(declaracoesDir, `${declaracao.id}.pdf`);

  // Também oferece salvar onde o usuário quiser
  const destino =
    win != null
      ? await dialog.showSaveDialog(win, {
          title: 'Salvar Declaração',
          defaultPath: nomeArquivo,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        })
      : { canceled: true, filePath: '' };

  if (destino.canceled || !destino.filePath) {
    db.prepare('DELETE FROM declaracoes WHERE id = ?').run(declaracao.id);
    if (webResult.ok) removerDoWeb(codigo).catch(() => {});
    return { ok: false, error: 'Operação cancelada pelo usuário' };
  };

  const urlVerificacao = gerarUrlValidacao({
    n: aluno.nome,
    m: aluno.matricula || String(aluno.id),
    c: aluno.curso || undefined,
    f: aluno.faculdade || undefined,
    t: tipo === 'diploma' ? 'Declaração de Autenticidade de Diploma' : tipo === 'historico' ? 'Declaração de Autenticidade de Histórico Escolar' : 'Declaração de Autenticidade',
    e: agora,
    k: codigo,
  });
  const qrBuffer = await gerarQrPng(urlVerificacao);

  // dados complementares para o texto da declaração
  const fac = getFaculdadeInfo(aluno.faculdade);
  const cursoInfo = aluno.curso && fac.cursos[aluno.curso] ? fac.cursos[aluno.curso] : null;
  const cursoTexto = (cursoInfo?.nome || aluno.curso || '').toUpperCase();
  const diretor = fac.diretor || '—';
  const faculdadeNome = fac.nome || aluno.faculdade || '—';
  const discRows = db
    .prepare('SELECT ch FROM historico_disciplinas WHERE aluno_id = ?')
    .all(aluno.id) as { ch: string | null }[];
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
    semAssinatura,
    tipo,
    diplomaReferenciado,
  });

  // Salva cópia interna para re-download
  try {
    fs.copyFileSync(destino.filePath, caminhoInterno);
    db.prepare('UPDATE declaracoes SET pdf_caminho = ? WHERE id = ?').run(caminhoInterno, declaracao.id);
  } catch { /* ignora se falhar */ }

  return {
    ok: true,
    data: {
      declaracao,
      pdfPath: destino.filePath,
      enviadoWeb: webResult.ok,
    },
  };
}

function listar(_event: IpcMainInvokeEvent, alunoId?: number): ApiResult<any[]> {
  const db = getDb();
  const rows =
    alunoId != null
      ? db
          .prepare(
            `SELECT d.*, a.nome AS aluno_nome, a.matricula AS aluno_matricula,
                    u.nome AS emitido_por_nome, u.codigo AS emitido_por_codigo
             FROM declaracoes d
             JOIN alunos a ON a.id = d.aluno_id
             JOIN usuarios u ON u.id = d.emitido_por
             WHERE d.aluno_id = ?
             ORDER BY d.emitido_em DESC`
          )
          .all(alunoId)
      : db
          .prepare(
            `SELECT d.*, a.nome AS aluno_nome, a.matricula AS aluno_matricula,
                    u.nome AS emitido_por_nome, u.codigo AS emitido_por_codigo
             FROM declaracoes d
             JOIN alunos a ON a.id = d.aluno_id
             JOIN usuarios u ON u.id = d.emitido_por
             ORDER BY d.emitido_em DESC`
          )
          .all();
  return { ok: true, data: rows };
}

async function removerDoWeb(codigo: string): Promise<boolean> {
  try {
    const url = `${CONFIG.VERIFICACAO_BASE_URL.replace(/\/$/, '')}/api/declaracoes/${encodeURIComponent(codigo)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, {
      method: 'DELETE',
      headers: { 'x-api-key': CONFIG.VERIFICACAO_API_KEY },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return resp.ok;
  } catch {
    return false;
  }
}

async function excluir(
  _event: IpcMainInvokeEvent,
  id: number,
  senha: string
): Promise<ApiResult<{ webOk: boolean }>> {
  const sessao = getSessao();
  const erro = validarExclusaoDeclaracao({
    sessao,
    senha,
    senhaMasterHash: CONFIG.SENHA_EXCLUSAO_DECLARACAO_HASH,
  });
  if (erro) return { ok: false, error: erro };

  const db = getDb();

  const decl = db
    .prepare('SELECT codigo_verificacao FROM declaracoes WHERE id = ?')
    .get(id) as { codigo_verificacao: string } | undefined;

  if (!decl) return { ok: false, error: 'Declaração não encontrada' };

  db.prepare('DELETE FROM declaracoes WHERE id = ?').run(id);

  const webOk = await removerDoWeb(decl.codigo_verificacao);

  return { ok: true, data: { webOk } };
}

async function baixar(
  event: IpcMainInvokeEvent,
  id: number
): Promise<ApiResult<{ salvoPath: string }>> {
  const db = getDb();
  const decl = db.prepare('SELECT * FROM declaracoes WHERE id = ?').get(id) as (Declaracao & { pdf_caminho?: string | null }) | undefined;
  if (!decl) return { ok: false, error: 'Declaração não encontrada' };

  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, error: 'Janela não disponível' };

  // Tenta o caminho salvo, senão o padrão em userData
  let pdfPath = decl.pdf_caminho || '';
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    pdfPath = path.join(app.getPath('userData'), 'declaracoes', `${id}.pdf`);
  }
  if (!fs.existsSync(pdfPath)) {
    return { ok: false, error: 'Arquivo PDF da declaração não encontrado. Re-genere a declaração.' };
  }

  const aluno = db.prepare('SELECT nome, matricula FROM alunos WHERE id = ?').get(decl.aluno_id) as { nome: string; matricula: string } | undefined;
  const nomeSugerido = `declaracao-${aluno?.matricula || id}.pdf`;

  const res = await dialog.showSaveDialog(win, {
    title: 'Salvar Cópia da Declaração',
    defaultPath: nomeSugerido,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });

  if (res.canceled || !res.filePath) return { ok: false, error: 'Operação cancelada' };

  fs.copyFileSync(pdfPath, res.filePath);
  return { ok: true, data: { salvoPath: res.filePath } };
}

export function registrarDeclaracaoHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.DECLARACAO_EMITIR, requerAuth(emitir));
  ipcMain.handle(IPC_CHANNELS.DECLARACAO_LISTAR, requerAuth(listar));
  ipcMain.handle(IPC_CHANNELS.DECLARACAO_EXCLUIR, requerAuth(excluir));
  ipcMain.handle(IPC_CHANNELS.DECLARACAO_BAIXAR, requerAuth(baixar));
}
