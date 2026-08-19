// Renderizador de Histórico Escolar para a FACIIP baseado em HTML + CSS.
// O PDF é gerado via Chromium (webContents.printToPDF), garantindo fidelidade
// visual ao template HTML e aos CSS (style.css / print.css) que são a fonte
// de verdade compartilhada por TODOS os cursos da FACIIP.
import { BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Aluno, HistoricoDisciplina } from './types';
import type { CursoInfo, FaculdadeInfo } from './faculdades';
import { getAssinaturaAtiva } from './ipc/assinatura';
import { formatarDataHoraBrasilia } from './utils';
import { textoInstrucaoQr } from './qr-validador';

// ============================================================
// CSS — fonte única compartilhada por todos os históricos FACIIP
// ============================================================

export const STYLE_CSS = `
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --paper-width: 210mm;
  --paper-height: 297mm;
  --page-padding: 10mm;
  --font-family: Arial, Helvetica, sans-serif;
  --font-size: 10px;
  --line-height: 1.3;
  --border: 1px solid #000;
}

body {
  background: #fff;
  font-family: var(--font-family);
  font-size: var(--font-size);
  color: #000;
  line-height: var(--line-height);
}

.page {
  width: var(--paper-width);
  min-height: var(--paper-height);
  margin: 0 auto;
  background: #fff;
  padding: var(--page-padding);
  position: relative;
}

.header { width: 100%; margin-bottom: 12px; }
.header-top { display: flex; justify-content: space-between; align-items: flex-start; }
.institution { width: 76%; display: flex; align-items: center; gap: 10px; }
.institution .inst-text { flex: 1; }
.institution .inst-logo { height: 52px; width: auto; flex-shrink: 0; object-fit: contain; }
.institution h2 { font-size: 15px; font-weight: bold; margin-bottom: 3px; }
.institution p { font-size: 9px; line-height: 1.25; }
.page-info { width: 20%; text-align: right; }
.page-info h3 { font-size: 13px; font-weight: bold; margin-bottom: 4px; }
.page-info span { font-size: 10px; }
.document-title { text-align: center; font-size: 13px; font-weight: bold; margin-top: 10px; margin-bottom: 10px; }

.student-info { margin-bottom: 10px; }
.student-info .row { display: flex; gap: 10px; margin-bottom: 6px; }
.field { flex: 1; display: flex; align-items: center; gap: 4px; }
.field label { font-weight: bold; white-space: nowrap; }
.field span { flex: 1; min-height: 16px; border-bottom: 1px solid #000; }
.field-lg { flex: 3; }
.field-md { flex: 1; }

.course-info { margin-bottom: 10px; }
.course-info h4 { font-size: 11px; margin-bottom: 5px; font-weight: bold; }
.course-box { border: var(--border); padding: 6px; }
.course-box p { margin-bottom: 6px; }
.course-box .row { display: flex; gap: 25px; margin-top: 6px; }

.subjects-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9px; margin-top: 8px; }
.subjects-table thead th { border: 1px solid #000; background: #fff; text-align: center; font-weight: bold; padding: 4px 3px; vertical-align: middle; line-height: 1.15; }
.subjects-table tbody td { border: 1px solid #000; padding: 3px 4px; vertical-align: middle; word-wrap: break-word; overflow-wrap: break-word; line-height: 1.2; }
.subjects-table th:nth-child(1), .subjects-table td:nth-child(1) { width: 48px; text-align: center; }
.subjects-table th:nth-child(2), .subjects-table td:nth-child(2) { width: auto; text-align: left; }
.subjects-table th:nth-child(3), .subjects-table td:nth-child(3) { width: 185px; text-align: left; font-size: 8.5px; }
.subjects-table th:nth-child(4), .subjects-table td:nth-child(4) { width: 75px; text-align: center; font-size: 8.5px; }
.subjects-table th:nth-child(5), .subjects-table td:nth-child(5) { width: 35px; text-align: center; }
.subjects-table th:nth-child(6), .subjects-table td:nth-child(6) { width: 30px; text-align: center; }
.subjects-table th:nth-child(7), .subjects-table td:nth-child(7) { width: 42px; text-align: center; }
.subjects-table th:nth-child(8), .subjects-table td:nth-child(8) { width: 62px; text-align: center; }
.subjects-table .semester td { background: #f3f3f3; font-weight: bold; font-size: 9px; text-align: left; padding: 4px 6px; }
.subjects-table tbody tr:not(.semester) { height: 21px; }
.subjects-table .semester { height: 21px; }

.summary { margin-top: 18px; width: 320px; }
.summary table { width: 100%; border-collapse: collapse; }
.summary td { border: 1px solid #000; padding: 5px; font-size: 10px; }
.summary td:first-child { width: 75%; }
.summary td.value { width: 25%; text-align: center; font-weight: bold; }

.legend { margin-top: 18px; margin-bottom: 12px; font-size: 10px; }
.legend p { display: flex; gap: 18px; align-items: center; }

.enade { margin-top: 10px; margin-bottom: 18px; font-size: 10px; }
.enade p { margin-bottom: 5px; }

.signature { margin-top: 22px; margin-bottom: 22px; text-align: center; }
.signature-line { width: 320px; margin: 0 auto 8px; border-top: 1px solid #000; }
.signature strong { display: block; font-size: 10px; }
.signature span { display: block; font-size: 9px; margin-top: 2px; }
.signature-img { display: block; width: 238px; margin: 0 auto 4px; }

.observations { margin-top: 18px; font-size: 10px; }
.observations h4 { margin-bottom: 6px; font-size: 11px; font-weight: bold; }
.observations p { margin-bottom: 8px; text-align: justify; line-height: 1.45; }

.dates { display: flex; justify-content: space-between; gap: 40px; margin: 12px 0; }
.dates div { flex: 1; font-size: 10px; }

.footer { margin-top: 20px; border-top: 1px solid #000; padding-top: 8px; font-size: 9px; }
.footer p { margin-bottom: 4px; }

.verificacao { margin-top: 18px; text-align: center; }
.verificacao img { width: 70px; }
.verificacao p { font-size: 8px; margin-top: 2px; }

.page-break { page-break-after: always; break-after: page; }

/* Ajuste necessário: o template original usa overflow:hidden na página, o que
   cortaria disciplinas quando a tabela ultrapassa uma folha. Permitimos o fluxo
   para que toda a tabela seja visível (paginando naturalmente, com repetição do
   cabeçalho das colunas). */
.page { overflow: visible !important; }
`;

export const PRINT_CSS = `
@page { size: A4 portrait; margin: 10mm; }

html, body { margin: 0; padding: 0; background: #fff !important; font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #000; }
body { padding: 0; }
.page { width: 100%; min-height: auto; margin: 0; padding: 0; background: #fff; box-shadow: none; border: none; }
* { box-shadow: none !important; text-shadow: none !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

.header { page-break-inside: avoid; }
table { border-collapse: collapse; width: 100%; page-break-inside: auto; }
thead { display: table-header-group; }
tfoot { display: table-footer-group; }
tr { page-break-inside: avoid; page-break-after: auto; }
td, th { page-break-inside: avoid; }
.summary { page-break-inside: avoid; }
.signature { page-break-inside: avoid; }
.observations { page-break-inside: avoid; }
.footer { page-break-inside: avoid; }
.legend { page-break-inside: avoid; }
.enade { page-break-inside: avoid; }
.page-break { display: block; page-break-after: always; break-after: page; }
img { max-width: 100%; page-break-inside: avoid; }
p { orphans: 3; widows: 3; }
.field { break-inside: avoid; }
.student-info { break-inside: avoid; }
.course-info { break-inside: avoid; }
.summary table { width: 320px; }
a { color: #000; text-decoration: none; }
.no-print { display: none !important; }
.page:last-child { page-break-after: auto; }
`;

// ============================================================
// Helpers
// ============================================================

function esc(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatarNome(s: string): string {
  if (!s) return '';
  if (/[a-zà-ÿ]/.test(s) && s !== s.toUpperCase()) return s;
  const pequenas = new Set([
    'e', 'de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'em', 'no', 'na', 'nos', 'nas',
    'para', 'com', 'sem', 'por', 'ao', 'à', 'às', 'que', 'ou',
  ]);
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((p, i) => {
      if (i > 0 && pequenas.has(p.replace(/[^\wÀ-ÿ-]/g, ''))) return p;
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join(' ');
}

function formatarDataOuVazio(s: string | null | undefined): string {
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
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

function titulacaoFaciip(t: string | null | undefined): string {
  const s = (t || '').toUpperCase().trim();
  const map: Record<string, string> = {
    DOUTOR: 'Doutor',
    DOUTORA: 'Doutora',
    MESTRADO: 'Mestre',
    MESTRE: 'Mestre',
    'MESTRADO/DOUTORADO': 'Mestre/Doutorado',
    ESPECIALISTA: 'Especialista',
    ESPECIALIZACAO: 'Especialista',
    ESPECIALIZAÇÃO: 'Especialista',
    GRADUADO: 'Graduado',
    GRADUACAO: 'Graduado',
    GRADUAÇÃO: 'Graduado',
  };
  return map[s] || t || '';
}

function situacaoFaciip(status: string | null | undefined): string {
  const s = (status || '').toUpperCase().trim();
  if (s === 'CUMPRIDA' || s === 'CUMP') return 'Cumprida';
  if (s === 'AP' || s === 'APROVADO') return 'Aprovado';
  if (s === 'REP' || s === 'REPROVADO') return 'Reprovado';
  if (s === 'MAT') return 'Matriculado';
  if (s === 'TRANC') return 'Trancado';
  return status || '';
}

// ============================================================
// Perfil por curso
// ============================================================

export interface PerfilCursoFaciip {
  cursoComCodigo: string;
  autorizacao: string;
  mostrarTituloInfoCurso: boolean;
  mostrarDataIngresso: boolean;
  conteudoProcessoSeletivo?: string;
  enadeBloco: 'dispensa' | 'blank';
  observacoesCurso: string;
  tituloObtido: string;
  disciplinasUppercase: boolean;
  periodoVazio: boolean;
}

export function obterPerfilFaciip(curso: string, cursoInfo: CursoInfo | null): PerfilCursoFaciip {
  const nomeCurso = cursoInfo?.nome || curso;
  const codEmec = cursoInfo?.codEmec?.trim() || '';
  const cursoComCodigo = codEmec ? `${nomeCurso} (${codEmec})` : nomeCurso;
  const autorizacao = (cursoInfo?.regulatory || '').replace(/^Autorização do Curso\s*/i, '').trim();

  const base: Omit<PerfilCursoFaciip, 'observacoesCurso'> = {
    cursoComCodigo,
    autorizacao,
    mostrarTituloInfoCurso: false,
    mostrarDataIngresso: false,
    conteudoProcessoSeletivo: undefined,
    enadeBloco: 'blank',
    tituloObtido: 'Bacharel(a)',
    disciplinasUppercase: true,
    periodoVazio: true,
  };

  if (/pedagogia/i.test(curso)) {
    return {
      ...base,
      mostrarTituloInfoCurso: true,
      observacoesCurso: 'Licenciatura em Pedagogia',
      tituloObtido: 'Licenciado(a)',
      disciplinasUppercase: false,
    };
  }

  const mostrarTitulo = /relações públicas/i.test(curso) || /jornalismo/i.test(curso);

  let observacoesCurso = nomeCurso;
  if (/hospitalar/i.test(curso)) {
    observacoesCurso = 'Administração com Habilitação em Administração Hospitalar';
  } else if (/jornalismo/i.test(curso)) {
    observacoesCurso = 'Comunicação Social com Habilitação em Jornalismo';
  } else if (/contábeis/i.test(curso)) {
    observacoesCurso = 'Ciências Contábeis';
  } else if (/mecânica/i.test(curso)) {
    observacoesCurso = 'Engenharia de Produção Mecânica';
  } else if (/turismo/i.test(curso)) {
    observacoesCurso = 'Turismo e Hotelaria';
  }

  return {
    ...base,
    mostrarTituloInfoCurso: mostrarTitulo,
    observacoesCurso,
  };
}

// ============================================================
// Geração do HTML
// ============================================================

function renderHeader(faculdade: FaculdadeInfo, pag: number, total: number, logoDataUrl: string | null): string {
  const logoImg = logoDataUrl ? `<img class="inst-logo" src="${logoDataUrl}" alt="">` : '';
  return `<header class="header">
    <div class="header-top">
      <div class="institution">
        ${logoImg}
        <div class="inst-text">
          <h2>Faculdades Integradas Ipitanga</h2>
          <p>${esc(faculdade.registroRtd || '')}</p>
        </div>
      </div>
      <div class="page-info">
        <h3>Histórico Escolar</h3>
        <span>Pág. ${pag}/${total}</span>
      </div>
    </div>
    <div class="document-title">HISTÓRICO ESCOLAR</div>
  </header>`;
}

function renderStudentInfo(aluno: Aluno): string {
  const nat = aluno.nacionalidade || 'Brasileiro';
  return `<section class="student-info">
    <div class="row">
      <div class="field field-lg"><label>Aluno(a):</label><span>${esc(aluno.nome || '')}</span></div>
      <div class="field field-md"><label>CPF:</label><span>${esc(aluno.cpf || '')}</span></div>
    </div>
    <div class="row">
      <div class="field"><label>Matrícula:</label><span>${esc(aluno.matricula || '')}</span></div>
      <div class="field"><label>Data de Nascimento:</label><span>${esc(formatarDataOuVazio(aluno.data_nascimento))}</span></div>
      <div class="field"><label>Sexo:</label><span>${esc(aluno.sexo || '')}</span></div>
    </div>
    <div class="row">
      <div class="field"><label>Nacionalidade:</label><span>${esc(nat)}</span></div>
      <div class="field"><label>R.G.:</label><span>${esc(aluno.rg || '')}</span></div>
      <div class="field"><label>Naturalidade:</label><span>${esc(aluno.naturalidade || '')}</span></div>
    </div>
  </section>`;
}

function renderCourseInfo(aluno: Aluno, perfil: PerfilCursoFaciip): string {
  const h4 = perfil.mostrarTituloInfoCurso ? '<h4>Informação do Curso</h4>\n' : '';
  const ingresso = perfil.mostrarDataIngresso
    ? `<div class="row">
        <div class="field"><strong>Data Ingresso:</strong> ${esc(aluno.ano_ingresso || '')}</div>
        <div class="field"><strong>Forma de Ingresso:</strong> ${esc(aluno.forma_ingresso || 'Vestibular')}</div>
      </div>`
    : `<div class="row"><div class="field"><strong>Forma de Ingresso:</strong> ${esc(aluno.forma_ingresso || 'Vestibular')}</div></div>`;
  const processo = perfil.conteudoProcessoSeletivo
    ? `<p><strong>Conteúdo do Processo Seletivo:</strong> ${esc(perfil.conteudoProcessoSeletivo)}</p>`
    : '';
  return `<section class="course-info">
    ${h4}<div class="course-box">
      <p><strong>Curso:</strong> ${esc(perfil.cursoComCodigo)}</p>
      <p><strong>Autorização do Curso:</strong> ${esc(perfil.autorizacao)}</p>
      ${ingresso}
      ${processo}
    </div>
  </section>`;
}

function renderTabela(disciplinas: HistoricoDisciplina[], perfil: PerfilCursoFaciip): string {
  const periodos: string[] = [];
  for (const d of disciplinas) if (!periodos.includes(d.periodo)) periodos.push(d.periodo);
  periodos.sort();

  let body = '';
  periodos.forEach((periodo, idx) => {
    const discs = disciplinas.filter((d) => d.periodo === periodo);
    if (!discs.length) return;
    body += `<tr class="semester"><td colspan="8"><strong>${idx + 1}º Semestre</strong></td></tr>`;
    for (const d of discs) {
      const disc = perfil.disciplinasUppercase
        ? (d.disciplina || '').toUpperCase()
        : formatarNome(d.disciplina || '');
      const periodoCell = perfil.periodoVazio ? '' : esc(periodo);
      body += `<tr>
        <td>${periodoCell}</td>
        <td>${esc(disc)}</td>
        <td>${esc(formatarNome(d.docente || ''))}</td>
        <td>${esc(titulacaoFaciip(d.titulacao))}</td>
        <td>${esc(d.ch || '')}</td>
        <td>${esc(d.ft || '')}</td>
        <td>${esc(d.nota || '')}</td>
        <td>${esc(situacaoFaciip(d.status))}</td>
      </tr>`;
    }
  });

  return `<table class="subjects-table">
    <thead>
      <tr>
        <th>Período</th>
        <th>Componentes Curriculares</th>
        <th>Docente</th>
        <th>Titulação</th>
        <th>CH</th>
        <th>FT</th>
        <th>Nota</th>
        <th>Situação</th>
      </tr>
    </thead>
    <tbody>
      ${body}
    </tbody>
  </table>`;
}

interface HtmlOpts {
  aluno: Aluno;
  disciplinas: HistoricoDisciplina[];
  faculdade: FaculdadeInfo;
  cursoInfo: CursoInfo | null;
  perfil: PerfilCursoFaciip;
  codigoVerificacao: string;
  qrDataUrl: string | null;
  logoDataUrl: string | null;
  assinaturaImgDataUrl: string | null;
  nomeSignatario: string;
  cargoSignatario: string;
  emitidoEm: string;
}

export function gerarHtmlFaciip(opts: HtmlOpts): string {
  const { aluno, disciplinas, faculdade, cursoInfo, perfil, codigoVerificacao, qrDataUrl, logoDataUrl, assinaturaImgDataUrl, nomeSignatario, cargoSignatario, emitidoEm } = opts;
  const TOTAL = 2;

  // Resumo de carga horária
  const isAtividade = (d: HistoricoDisciplina) => /ATIVIDADES COMPLEMENTARES/i.test(d.disciplina || '');
  const chDisciplinas = disciplinas.filter((d) => !isAtividade(d)).reduce((s, d) => s + parseCh(d.ch), 0);
  const chAtividades = disciplinas.filter(isAtividade).reduce((s, d) => s + parseCh(d.ch), 0);
  const chTotal = disciplinas.reduce((s, d) => s + parseCh(d.ch), 0);
  const notas = disciplinas.map((d) => parseNota(d.nota)).filter((n): n is number => n !== null);
  const cr = notas.length ? notas.reduce((s, n) => s + n, 0) / notas.length : null;

  // ENADE (depende do perfil)
  const enade =
    perfil.enadeBloco === 'blank'
      ? `<section class="enade">
          <p><strong>Exame Nacional de Desempenho dos Estudantes - ENADE</strong></p>
          <p><strong>Data / Situação do ENADE:</strong> _______________________________________</p>
        </section>`
      : `<section class="enade">
          <p>Exame Nacional de Desempenho dos Estudantes – ENADE – Estudante dispensado de realização do ENADE, em razão do calendário trienal.</p>
        </section>`;

  // Assinatura
  const assImg = assinaturaImgDataUrl
    ? `<img class="signature-img" src="${assinaturaImgDataUrl}" alt="">`
    : '';
  const signature = `<section class="signature">
    ${assImg}
    <div class="signature-line"></div>
    <strong>${esc(nomeSignatario)}</strong>
    <span>${esc(cargoSignatario)}</span>
  </section>`;

  // Observações
  const statusDyn = !aluno.ano_conclusao || aluno.ano_conclusao === 'Cursando' ? 'Cursando' : 'Formado';
  const dataConclusao = aluno.ano_conclusao && aluno.ano_conclusao !== 'Cursando' ? formatarDataOuVazio(aluno.ano_conclusao) : '';
  const dataColacao = formatarDataOuVazio(aluno.data_colacao);
  const observations = `<section class="observations">
    <h4>Observações</h4>
    <p>Declaro que o(a) aluno(a) acima mencionado(a) cursou com aprovação todas as disciplinas obrigatórias, integralizou a carga horária total exigida e demais exigências para conclusão do Curso de ${esc(perfil.observacoesCurso)}, conforme grade curricular do curso.</p>
    <p><strong>Status:</strong> ${esc(statusDyn)}</p>
    <div class="dates">
      <div><strong>Data de Conclusão de Curso:</strong> ${esc(dataConclusao) || '_______________________'}</div>
      <div><strong>Data de Colação de Grau:</strong> ${esc(dataColacao) || '_______________________'}</div>
    </div>
    <p><strong>Título Obtido:</strong> ${esc(perfil.tituloObtido)}</p>
  </section>`;

  const footer = `<footer class="footer">
    <p><strong>OBSERVAÇÃO:</strong></p>
    <p>QUALQUER INFORMAÇÃO DEVE SER SOLICITADA ATRAVÉS DO NOSSO</p>
    <p>E-mail: ${esc(faculdade.email || 'contato@faciip.com.br')} &nbsp;&nbsp;&nbsp; WhatsApp: ${esc(faculdade.telefone || '(71) 9 2003-7875')}</p>
  </footer>`;

  // QR + verificação
  const verImg = qrDataUrl ? `<img src="${qrDataUrl}" alt="">` : '';
  const verificacao = `<div class="verificacao">
    ${verImg}
    <p>Código de verificação: ${esc(codigoVerificacao)}</p>
    <p>${esc(textoInstrucaoQr())}</p>
    <p>Emitido em ${esc(formatarDataHoraBrasilia(emitidoEm))} (horário de Brasília)</p>
  </div>`;

  const resumo = `<section class="summary">
    <table>
      <tbody>
        <tr><td>CH Disciplinas Cursadas</td><td class="value">${fmtNum(chDisciplinas) || ''}H</td></tr>
        <tr><td>CH Atividades Complementares</td><td class="value">${chAtividades ? `${fmtNum(chAtividades)}H` : ''}</td></tr>
        <tr><td>CH Total Cursada</td><td class="value">${fmtNum(chTotal)}H</td></tr>
        <tr><td>CH Total Exigida</td><td class="value">${fmtNum(chTotal)}H</td></tr>
        <tr><td>Coeficiente de Rendimento</td><td class="value">${cr != null ? cr.toFixed(1) : ''}</td></tr>
      </tbody>
    </table>
  </section>`;

  void cursoInfo;

  // PÁGINA 1
  const pagina1 = `<div class="page">
    ${renderHeader(faculdade, 1, TOTAL, logoDataUrl)}
    ${renderStudentInfo(aluno)}
    ${renderCourseInfo(aluno, perfil)}
    ${renderTabela(disciplinas, perfil)}
  </div>
  <div class="page-break"></div>`;

  // PÁGINA 2
  const pagina2 = `<div class="page">
    ${renderHeader(faculdade, 2, TOTAL, logoDataUrl)}
    ${renderStudentInfo(aluno)}
    ${renderCourseInfo(aluno, perfil)}
    ${resumo}
    <section class="legend">
      <p><strong>Legenda:</strong> CH = Carga Horária &nbsp;&nbsp;&nbsp; FT = Faltas</p>
    </section>
    ${enade}
    ${signature}
    ${observations}
    ${footer}
    ${verificacao}
  </div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Histórico Escolar - ${esc(perfil.cursoComCodigo)}</title>
  <style>${STYLE_CSS}</style>
  <style media="print">${PRINT_CSS}</style>
</head>
<body>
${pagina1}
${pagina2}
</body>
</html>`;
}

// ============================================================
// Renderização HTML -> PDF via Chromium
// ============================================================

export async function renderizarHtmlParaPdf(html: string, destinoPath: string): Promise<void> {
  const tmpHtml = path.join(os.tmpdir(), `hist-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tmpHtml, html, 'utf8');
  let win: BrowserWindow | null = null;
  try {
    win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } });
    await win.loadFile(tmpHtml);
    // Aguarda todas as imagens (logo, QR, assinatura) estarem carregadas/decodificadas
    // antes de imprimir, evitando PDF em branco onde deveria haver imagem.
    await win.webContents.executeJavaScript(`
      Promise.race([
        Promise.all(Array.from(document.images).map((img) =>
          img.complete && img.naturalWidth > 0
            ? Promise.resolve()
            : new Promise((res) => { img.onload = () => res(null); img.onerror = () => res(null); })
        )),
        new Promise((res) => setTimeout(res, 3000))
      ])
    `);
    // Pequena folga para o paint final do Chromium.
    await new Promise((res) => setTimeout(res, 120));
    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
    });
    fs.writeFileSync(destinoPath, pdfBuffer);
  } finally {
    try {
      win?.destroy();
    } catch {
      /* ignora */
    }
    try {
      fs.unlinkSync(tmpHtml);
    } catch {
      /* ignora */
    }
  }
}

export interface FaciipRenderOpts {
  aluno: Aluno;
  disciplinas: HistoricoDisciplina[];
  faculdade: FaculdadeInfo;
  cursoInfo: CursoInfo | null;
  destinoPath: string;
  codigoVerificacao: string;
  qrBuffer: Buffer | null;
  semAssinatura?: boolean;
  emitidoEm: string;
}

export async function renderHtmlFaciipPdf(opts: FaciipRenderOpts): Promise<void> {
  const { aluno, disciplinas, faculdade, cursoInfo, destinoPath, codigoVerificacao, qrBuffer, semAssinatura, emitidoEm } = opts;
  const perfil = obterPerfilFaciip(aluno.curso || '', cursoInfo);

  const qrDataUrl = qrBuffer ? `data:image/png;base64,${qrBuffer.toString('base64')}` : null;

  // Logo da faculdade no cabeçalho, alinhada ao lado do nome
  let logoDataUrl: string | null = null;
  if (faculdade.logoPath && fs.existsSync(faculdade.logoPath)) {
    try {
      const buf = fs.readFileSync(faculdade.logoPath);
      logoDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
    } catch {
      logoDataUrl = null;
    }
  }

  // Assinatura digital (imagem), quando cadastrada e não suprimida
  let assinaturaImgDataUrl: string | null = null;
  const assinatura = getAssinaturaAtiva();
  const nomeSignatario = (assinatura?.nome_signatario || faculdade.diretor || 'PROF. DR. JOSÉ AUGUSTO MACIEL TORRES').toUpperCase();
  const cargoSignatario = (assinatura?.cargo || faculdade.cargoDiretor || 'Diretor Geral').toUpperCase();
  if (!semAssinatura && assinatura?.imagem_path && fs.existsSync(assinatura.imagem_path)) {
    try {
      const buf = fs.readFileSync(assinatura.imagem_path);
      assinaturaImgDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
    } catch {
      assinaturaImgDataUrl = null;
    }
  }

  const html = gerarHtmlFaciip({
    aluno,
    disciplinas,
    faculdade,
    cursoInfo,
    perfil,
    codigoVerificacao,
    qrDataUrl,
    logoDataUrl,
    assinaturaImgDataUrl,
    nomeSignatario,
    cargoSignatario,
    emitidoEm,
  });

  await renderizarHtmlParaPdf(html, destinoPath);
}
