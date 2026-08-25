import type { IpcMainInvokeEvent} from 'electron';
import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { getDb } from '../database';
import { CONFIG } from '../config';
import { getFaculdadeInfo } from '../faculdades';
import { IPC_CHANNELS } from '../types';
import type { Aluno, ApiResult } from '../types';
import { getSessao, requerAuth } from './auth';
import { getAssinaturaAtiva, assinarXml } from './assinatura';
import { gerarPdf } from './diploma-pdf';
import { assinarPdfSeConfigurado } from '../pades';
import { gerarUrlValidacao } from '../qr-validador';
import { registrarDeclaracaoWeb, removerDeclaracaoWeb } from '../web-registro';
import { logger } from '../utils/logger';
import { validarSenhaMaster } from '../utils/regras';
import { montarNomePdf, montarNomeArquivo, gravarArquivoSeguro } from '../utils/sistema';
import { gerarHashConteudo, gerarQrPng } from '../utils';
import { agendarCompartilharPdf, garantirPdfLocal } from '../pdf-sync';

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

  // Registra o código no serviço de verificação web para o QR do diploma validar.
  // Falha não bloqueia a emissão — o retry do boot reenvia pendentes.
  const webResult = await registrarDeclaracaoWeb({
    codigo_verificacao: codigo,
    hash_conteudo: hash,
    aluno,
    emitidoEm: agora,
  });
  if (!webResult.ok) {
    logger.warn({ diplomaId, erro: webResult.error }, 'Falha ao enviar diploma para web');
  }
  const enviadoWeb = webResult.ok ? 1 : 0;

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
    cursoRegulatory: cursoInfo?.regulatory,
    cargaHorariaTotal,
    faculdadeNome,
    diretor,
    emitidoPorNome: sessao.usuario.nome,
    faculdade: fac,
    assinatura: getAssinaturaAtiva(),
    semAssinatura,
  });

  // Assinatura digital PAdES (A1/A3) — automática quando há certificado ativo.
  const assinado = await assinarPdfSeConfigurado(destino.filePath, { semAssinatura, senha: senhaPfx, razao: 'Diploma de Conclusão' });
  if (!assinado.ok) {
    try { fs.unlinkSync(destino.filePath); } catch { /* noop */ }
    db.prepare('DELETE FROM diplomas WHERE id = ?').run(diplomaId);
    if (enviadoWeb) removerDeclaracaoWeb(codigo).catch(() => {});
    return { ok: false, error: assinado.error ?? 'Falha ao assinar o diploma.' };
  }

  try {
    fs.copyFileSync(destino.filePath, caminhoInterno);
    db.prepare('UPDATE diplomas SET pdf_caminho = ? WHERE id = ?').run(caminhoInterno, diplomaId);
  } catch { /* ignora */ }

  // Compartilha o PDF assinado na nuvem (as outras máquinas baixam no "Baixar").
  agendarCompartilharPdf('diplomas', diplomaId, caminhoInterno);

  if (enviadoWeb) {
    try {
      db.prepare('UPDATE diplomas SET enviado_web = 1 WHERE id = ?').run(diplomaId);
    } catch { /* ignora */ }
  }

  return {
    ok: true,
    data: {
      id: diplomaId,
      codigo_verificacao: codigo,
      hash_conteudo: hash,
      enviado_web: enviadoWeb,
      pdfPath: destino.filePath,
      enviadoWeb: !!enviadoWeb,
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
  const dip = db.prepare('SELECT id, codigo_verificacao FROM diplomas WHERE id = ?').get(id) as
    | { id: number; codigo_verificacao: string }
    | undefined;
  if (!dip) return { ok: false, error: 'Diploma não encontrado' };
  db.prepare('DELETE FROM diplomas WHERE id = ?').run(id);
  // Remove também do serviço de verificação web — diploma excluído não deve
  // mais validar como autêntico ao escanear o QR (best-effort).
  const webOk = await removerDeclaracaoWeb(dip.codigo_verificacao);
  if (!webOk) logger.warn({ diplomaId: id }, 'Diploma excluído localmente, mas código permanece no serviço web');
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
    // Emitido em outra máquina (o token A3 é de uma máquina só): baixa da nuvem.
    const baixou = await garantirPdfLocal('diplomas', id, pdfPath);
    if (!baixou) {
      return {
        ok: false,
        error:
          'Arquivo PDF não encontrado nesta máquina nem na nuvem. ' +
          'Se foi emitido em outro computador, peça para que ele esteja conectado à internet e tente novamente.',
      };
    }
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

function escapeXml(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatarDataXml(s: string | null | undefined): string {
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

async function gerarXmlDiploma(
  event: IpcMainInvokeEvent,
  diplomaId: number,
  senhaPfx?: string
): Promise<ApiResult<{ xmlPath: string; aviso?: string }>> {
  const sessao = getSessao();
  if (!sessao) return { ok: false, error: 'Não autenticado' };

  const db = getDb();
  const row = db
    .prepare(
      `SELECT d.*, a.nome AS aluno_nome, a.matricula AS aluno_matricula, a.cpf AS aluno_cpf,
              a.rg AS aluno_rg, a.orgao_emissor AS aluno_orgao_emissor, a.sexo AS aluno_sexo,
              a.data_nascimento AS aluno_data_nascimento, a.naturalidade AS aluno_naturalidade,
              a.nacionalidade AS aluno_nacionalidade, a.curso AS aluno_curso, a.turno AS aluno_turno,
              a.faculdade AS aluno_faculdade, a.forma_ingresso AS aluno_forma_ingresso,
              a.ano_conclusao AS aluno_ano_conclusao, a.data_colacao AS aluno_data_colacao,
              u.nome AS emitido_por_nome
       FROM diplomas d
       JOIN alunos a ON a.id = d.aluno_id
       JOIN usuarios u ON u.id = d.emitido_por
       WHERE d.id = ?`
    )
    .get(diplomaId) as any | undefined;
  if (!row) return { ok: false, error: 'Diploma não encontrado' };

  const aluno = {
    id: row.aluno_id,
    nome: row.aluno_nome,
    matricula: row.aluno_matricula,
    cpf: row.aluno_cpf,
    rg: row.aluno_rg,
    orgao_emissor: row.aluno_orgao_emissor,
    sexo: row.aluno_sexo,
    data_nascimento: row.aluno_data_nascimento,
    naturalidade: row.aluno_naturalidade,
    nacionalidade: row.aluno_nacionalidade,
    curso: row.aluno_curso,
    turno: row.aluno_turno,
    faculdade: row.aluno_faculdade,
    forma_ingresso: row.aluno_forma_ingresso,
    ano_conclusao: row.aluno_ano_conclusao,
    data_colacao: row.aluno_data_colacao,
  } as Aluno;

  const fac = getFaculdadeInfo(aluno.faculdade);
  const cursoInfo = aluno.curso && fac.cursos[aluno.curso] ? fac.cursos[aluno.curso] : null;
  const cursoNome = cursoInfo?.nome || aluno.curso || '';
  const e = escapeXml;

  const discRows = db.prepare('SELECT ch FROM historico_disciplinas WHERE aluno_id = ?').all(aluno.id) as { ch: string | null }[];
  const cargaHorariaTotal = discRows.reduce((s, d) => {
    const n = parseInt((d.ch ?? '').replace(/\D/g, '') || '0', 10);
    return s + (isNaN(n) ? 0 : n);
  }, 0);

  const dataConclusao = aluno.ano_conclusao && aluno.ano_conclusao !== 'Cursando' ? formatarDataXml(aluno.ano_conclusao) : '';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<diploma xmlns="https://nexa-class.edu/diploma">
  <cabecalho>
    <sistema>NEXA CLASS</sistema>
    <geradoEm>${new Date().toISOString()}</geradoEm>
    <instituicao>${e(fac.nome)}</instituicao>
    <cnpj>${e(fac.cnpj ?? '')}</cnpj>
  </cabecalho>
  <aluno>
    <nome>${e(aluno.nome)}</nome>
    <matricula>${e(aluno.matricula)}</matricula>
    <cpf>${e(aluno.cpf || '')}</cpf>
    <rg>${e(aluno.rg || '')}</rg>
    <orgaoEmissor>${e(aluno.orgao_emissor || '')}</orgaoEmissor>
    <sexo>${e(aluno.sexo || '')}</sexo>
    <dataNascimento>${e(formatarDataXml(aluno.data_nascimento))}</dataNascimento>
    <naturalidade>${e(aluno.naturalidade || '')}</naturalidade>
    <nacionalidade>${e(aluno.nacionalidade || '')}</nacionalidade>
  </aluno>
  <curso>
    <nome>${e(cursoNome)}</nome>
    <codEmec>${e(cursoInfo?.codEmec || '')}</codEmec>
    <turno>${e(cursoInfo?.turno || aluno.turno || '')}</turno>
    <regulatorio>${e(cursoInfo?.regulatory || '')}</regulatorio>
  </curso>
  <conclusao>
    <cargaHorariaTotal>${cargaHorariaTotal}</cargaHorariaTotal>
    <formaIngresso>${e(aluno.forma_ingresso || 'Vestibular')}</formaIngresso>
    <dataConclusao>${e(dataConclusao)}</dataConclusao>
    <dataColacao>${e(formatarDataXml(aluno.data_colacao))}</dataColacao>
    <titulo>Bacharelado</titulo>
  </conclusao>
  <verificacao>
    <codigo>${e(row.codigo_verificacao)}</codigo>
    <hash>${e(row.hash_conteudo)}</hash>
    <emitidoEm>${e(row.emitido_em)}</emitidoEm>
    <emitidoPor>${e(row.emitido_por_nome)}</emitidoPor>
  </verificacao>
</diploma>
`;

  const win = BrowserWindow.fromWebContents(event.sender);
  const nomeArquivo = montarNomeArquivo('diploma', aluno.nome, aluno.matricula || String(aluno.id), diplomaId, 'xml');
  const destino = win
    ? await dialog.showSaveDialog(win, {
        title: 'Salvar Diploma XML',
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
    logger.warn({ destino: destino.filePath, erro: gravado.erro }, 'Falha ao gravar XML do diploma');
    return { ok: false, error: gravado.erro };
  }
  if (gravado.usouFallback) {
    logger.warn({ destino: destino.filePath, fallback: gravado.caminho }, 'Pasta de destino bloqueada — XML do diploma salvo em fallback');
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

/**
 * Reenvia ao serviço de verificação web os diplomas ainda não registrados
 * (enviado_web = 0) — cobre emissões feitas offline e as versões anteriores,
 * em que o QR do diploma nunca era registrado. Chamada no boot do app.
 */
export async function reenviarDiplomasPendentesWeb(): Promise<void> {
  const db = getDb();
  let pendentes: any[] = [];
  try {
    pendentes = db
      .prepare(
        `SELECT d.id, d.codigo_verificacao, d.hash_conteudo, d.emitido_em,
                a.id AS aluno_id, a.nome AS aluno_nome, a.matricula AS aluno_matricula
         FROM diplomas d
         JOIN alunos a ON a.id = d.aluno_id
         WHERE d.enviado_web = 0`
      )
      .all();
  } catch {
    return;
  }
  if (!pendentes.length) return;

  logger.info({ total: pendentes.length }, 'Reenviando diplomas pendentes para o serviço web');
  let okCount = 0;
  for (const d of pendentes) {
    try {
      const aluno = db.prepare('SELECT * FROM alunos WHERE id = ?').get(d.aluno_id) as Aluno | undefined;
      if (!aluno) continue;
      const r = await registrarDeclaracaoWeb({
        codigo_verificacao: d.codigo_verificacao,
        hash_conteudo: d.hash_conteudo,
        aluno,
        emitidoEm: d.emitido_em,
      });
      if (r.ok) {
        db.prepare('UPDATE diplomas SET enviado_web = 1 WHERE id = ?').run(d.id);
        okCount++;
      }
    } catch { /* tenta o próximo no próximo boot */ }
  }
  logger.info({ ok: okCount, total: pendentes.length }, 'Reenvio de diplomas pendentes concluído');
}

export function registrarDiplomaHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.DIPLOMA_EMITIR, requerAuth(emitir));
  ipcMain.handle(IPC_CHANNELS.DIPLOMA_LISTAR, requerAuth(listar));
  ipcMain.handle(IPC_CHANNELS.DIPLOMA_EXCLUIR, requerAuth(excluir));
  ipcMain.handle(IPC_CHANNELS.DIPLOMA_BAIXAR, requerAuth(baixar));
  ipcMain.handle(IPC_CHANNELS.DIPLOMA_GERAR_XML, requerAuth(gerarXmlDiploma));
}
