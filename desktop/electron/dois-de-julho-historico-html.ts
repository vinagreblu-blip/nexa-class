// Renderizador de Histórico Escolar para a Faculdade 2 de Julho baseado em HTML + CSS.
// O PDF é gerado via Chromium (webContents.printToPDF), garantindo fidelidade
// visual ao template HTML e aos CSS (style.css / print.css) que são a fonte
// de verdade compartilhada por TODOS os cursos da Faculdade 2 de Julho.
import fs from 'node:fs';
import type { Aluno, HistoricoDisciplina } from './types';
import type { CursoInfo, FaculdadeInfo } from './faculdades';
import { getAssinaturaAtiva } from './ipc/assinatura';
import { formatarDataHoraBrasilia } from './utils';
import { renderizarHtmlParaPdf } from './faciip-historico-html';

// ============================================================
// Constantes por curso
// ============================================================

const CH_TOTAL_EXIGIDA: Record<string, number> = {
  Direito: 3700,
};

interface TituloCurso {
  titulo: string;
  tituloObtido: string;
}

function obterTituloCurso(cursoInfo: CursoInfo | null, aluno: Aluno): TituloCurso {
  const nome = (cursoInfo?.nome || aluno.curso || '').toLowerCase();
  if (nome.includes('direito')) {
    return { titulo: 'Bacharel em Direito.', tituloObtido: 'Bacharel(a)' };
  }
  return { titulo: cursoInfo?.nome || aluno.curso || '', tituloObtido: 'Bacharel(a)' };
}

// ============================================================
// CSS — fonte única compartilhada por todos os históricos 2 de Julho
// ============================================================

export const STYLE_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --page-width: 210mm;
  --page-height: 297mm;
  --page-padding: 8mm;
  --border-color: #000;
  --text-color: #000;
  --header-bg: #e6e6e6;
  --semester-bg: #d9d9d9;
  --font-main: Arial, Helvetica, sans-serif;
}
html, body { width: 100%; min-height: 100%; }
body {
  background: #e5e5e5;
  color: var(--text-color);
  font-family: var(--font-main);
  font-size: 9px;
  line-height: 1.2;
  padding: 20px;
}

/* ===== Página ===== */
.page {
  position: relative;
  width: var(--page-width);
  min-height: var(--page-height);
  margin: 0 auto 20px;
  padding: var(--page-padding);
  background: #fff;
  border: 1px solid #000;
  overflow: visible;
  max-width: 210mm;
}

/* ===== Cabeçalho institucional ===== */
.institution-header {
  display: flex;
  align-items: flex-start;
  width: 100%;
  min-height: 31mm;
  padding-bottom: 3mm;
  border-bottom: 1px solid #000;
}
.institution-logo {
  width: 42mm; min-width: 42mm; height: 25mm;
  display: flex; align-items: center; justify-content: center;
}
.institution-logo img {
  display: block; width: 100%; height: 100%; object-fit: contain;
}
.institution-info {
  flex: 1; padding-left: 5mm; text-align: center;
}
.institution-info h1 {
  margin-top: 1mm; font-size: 17px; line-height: 1.1; font-weight: 700;
}
.institution-info h2 {
  margin-top: 5mm; font-size: 14px; line-height: 1; font-weight: 700;
  text-transform: uppercase;
}
.institution-info p {
  margin-top: 2mm; font-size: 7.5px; line-height: 1.3;
}

/* ===== Bloco Histórico Escolar ===== */
.school-record {
  width: 100%; margin-top: 4mm; border: 1px solid #000;
}
.record-title {
  width: 100%; padding: 2.5mm 3mm;
  border-bottom: 1px solid #000;
  background: var(--header-bg);
  text-align: center;
  font-size: 11px; font-weight: 700; text-transform: uppercase;
}

/* ===== Informações do aluno ===== */
.student-information { width: 100%; }
.student-row {
  display: flex; width: 100%; min-height: 8mm;
  border-bottom: 1px solid #000;
}
.student-row:last-child { border-bottom: none; }
.student-field {
  min-height: 8mm; padding: 2mm 2.5mm;
  border-right: 1px solid #000;
  display: flex; align-items: center; gap: 2mm;
}
.student-field:last-child { border-right: none; }
.student-field strong { font-size: 8px; font-weight: 700; white-space: nowrap; }
.student-field span {
  flex: 1; min-height: 4mm; display: block;
  border-bottom: 1px dotted #555; font-size: 8px;
}
.student-row:nth-child(1) .student-field:first-child { width: 68%; }
.student-row:nth-child(1) .student-field:last-child { width: 32%; }
.student-row:nth-child(2) .student-field:nth-child(1) { width: 30%; }
.student-row:nth-child(2) .student-field:nth-child(2) { width: 45%; }
.student-row:nth-child(2) .student-field:nth-child(3) { width: 25%; }
.student-row:nth-child(3) .student-field:nth-child(1) { width: 30%; }
.student-row:nth-child(3) .student-field:nth-child(2) { width: 35%; }
.student-row:nth-child(3) .student-field:nth-child(3) { width: 35%; }

/* ===== Título / Informação do curso ===== */
.degree-information {
  width: 100%; padding: 3mm; border-top: 1px solid #000;
}
.degree-information p { font-size: 9px; line-height: 1.3; }
.course-information {
  width: 100%; padding: 3mm; border-top: 1px solid #000;
  font-size: 8px; line-height: 1.35;
}
.course-information p { margin-bottom: 1.5mm; }
.course-information p:last-child { margin-bottom: 0; }

/* ===== Tabela acadêmica ===== */
.academic-table {
  width: 100%; border-collapse: collapse; table-layout: fixed;
  margin-top: 4mm; color: #000; font-size: 7px;
}
.academic-table thead th {
  height: 9mm; padding: 2px 3px;
  border: 1px solid #000; background: var(--header-bg);
  text-align: center; vertical-align: middle;
  font-size: 7px; font-weight: 700; line-height: 1.1;
}
.academic-table th:nth-child(1), .academic-table td:nth-child(1) { width: 9%; }
.academic-table th:nth-child(2), .academic-table td:nth-child(2) { width: 30%; }
.academic-table th:nth-child(3), .academic-table td:nth-child(3) { width: 18%; }
.academic-table th:nth-child(4), .academic-table td:nth-child(4) { width: 12%; }
.academic-table th:nth-child(5), .academic-table td:nth-child(5) { width: 7%; }
.academic-table th:nth-child(6), .academic-table td:nth-child(6) { width: 6%; }
.academic-table th:nth-child(7), .academic-table td:nth-child(7) { width: 8%; }
.academic-table th:nth-child(8), .academic-table td:nth-child(8) { width: 10%; }
.academic-table tbody td {
  height: 6mm; padding: 2px 3px;
  border: 1px solid #000;
  vertical-align: middle; line-height: 1.1;
  overflow-wrap: break-word; word-wrap: break-word;
}
.academic-table tbody td:nth-child(1) { text-align: center; font-size: 7px; }
.academic-table tbody td:nth-child(2) { text-align: left; font-size: 7px; }
.academic-table tbody td:nth-child(3) { text-align: left; font-size: 6.5px; line-height: 1.15; }
.academic-table tbody td:nth-child(4) { text-align: center; font-size: 7px; white-space: nowrap; }
.academic-table tbody td:nth-child(5),
.academic-table tbody td:nth-child(6),
.academic-table tbody td:nth-child(7),
.academic-table tbody td:nth-child(8) {
  text-align: center; font-size: 7px; white-space: nowrap;
}
.academic-table .semester-header td {
  height: 6mm; padding: 2px 4px;
  background: var(--semester-bg); border: 1px solid #000;
  text-align: left; font-size: 8px; font-weight: 700; white-space: nowrap;
}

/* ===== Assinatura ===== */
.signature {
  width: 100%; margin-top: 7mm; text-align: center;
}
.signature-img { display: block; width: 238px; margin: 0 auto 4px; }
.signature-line {
  width: 70%; margin: 0 auto 2mm; border-top: 1px solid #000;
}
.signature-name { font-size: 9px; font-weight: 700; text-transform: uppercase; }
.signature-role { margin-top: 1mm; font-size: 8px; font-weight: 700; }

/* ===== Informações finais ===== */
.final-academic-information {
  display: grid; grid-template-columns: repeat(5, 1fr);
  width: 100%; margin-top: 6mm;
  border-top: 1px solid #000; border-left: 1px solid #000;
}
.final-field {
  min-height: 12mm; padding: 2mm;
  border-right: 1px solid #000; border-bottom: 1px solid #000;
  display: flex; flex-direction: column;
  justify-content: space-between; text-align: center;
}
.final-field strong { font-size: 7px; line-height: 1.15; }
.final-field span { min-height: 4mm; font-size: 8px; }

/* ===== Conclusão ===== */
.completion-information {
  width: 100%; margin-top: 3mm; border: 1px solid #000;
}
.completion-row {
  display: flex; width: 100%; min-height: 8mm;
  border-bottom: 1px solid #000;
}
.completion-row:last-child { border-bottom: none; }
.completion-field {
  flex: 1; padding: 2mm 3mm;
  border-right: 1px solid #000;
  display: flex; align-items: center; gap: 2mm;
}
.completion-field:last-child { border-right: none; }
.completion-field strong { font-size: 7.5px; white-space: nowrap; }
.completion-field span { font-size: 8px; }

/* ===== Observação ===== */
.observation {
  width: 100%; margin-top: 4mm; border: 1px solid #000;
}
.observation-title {
  padding: 2mm 3mm;
  border-bottom: 1px solid #000;
  background: var(--header-bg);
  font-size: 8px; font-weight: 700;
}
.observation-content {
  padding: 3mm; text-align: center;
  font-size: 7px; line-height: 1.35;
}

/* ===== Verificação (QR) ===== */
.verificacao { margin-top: 6mm; text-align: center; }
.verificacao img { width: 70px; }
.verificacao p { font-size: 8px; margin-top: 2px; }

/* ===== Quebra de página ===== */
.page-break { display: block; width: 100%; height: 0; page-break-after: always; break-after: page; }

/* ===== Links e imagens ===== */
a { color: #000; text-decoration: none; }
img { max-width: 100%; height: auto; display: block; }

/* ===== Controle de quebra ===== */
.institution-header, .school-record, .student-row,
.degree-information, .course-information,
.signature, .final-academic-information,
.completion-information, .observation, .verificacao {
  page-break-inside: avoid; break-inside: avoid;
}
.academic-table tr { page-break-inside: avoid; break-inside: avoid; }
`;

export const PRINT_CSS = `
@page { size: A4 portrait; margin: 0; }
html, body {
  width: 210mm; min-width: 210mm;
  margin: 0 !important; padding: 0 !important;
  background: #fff !important;
}
body {
  color: #000;
  font-family: Arial, Helvetica, sans-serif;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}
* {
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
  box-shadow: none !important;
  text-shadow: none !important;
}
.page {
  width: 210mm !important;
  min-height: auto !important;
  margin: 0 !important;
  padding: 8mm !important;
  background: #fff !important;
  border: none !important;
  overflow: visible !important;
}
.page-break { display: block; page-break-after: always; break-after: page; }

.institution-header { page-break-inside: avoid !important; break-inside: avoid !important; }
.school-record { page-break-inside: avoid !important; break-inside: avoid !important; }
.student-information, .student-row, .student-field {
  page-break-inside: avoid !important; break-inside: avoid !important;
}
.degree-information, .course-information {
  page-break-inside: avoid !important; break-inside: avoid !important;
}

.academic-table {
  width: 100% !important;
  border-collapse: collapse !important;
  table-layout: fixed !important;
  page-break-inside: auto; break-inside: auto;
}
.academic-table thead { display: table-header-group; }
.academic-table tbody { display: table-row-group; }
.academic-table tr { page-break-inside: avoid !important; break-inside: avoid !important; }
.academic-table th, .academic-table td {
  page-break-inside: avoid !important; break-inside: avoid !important;
  border-color: #000 !important;
}
.academic-table thead th { background: #e6e6e6 !important; }
.academic-table .semester-header td { background: #d9d9d9 !important; }

.signature, .final-academic-information, .completion-information,
.observation, .verificacao {
  page-break-inside: avoid !important; break-inside: avoid !important;
}

.school-record, .academic-table, .final-academic-information,
.completion-information, .observation {
  border-color: #000 !important;
}
.student-field, .degree-information, .course-information,
.academic-table th, .academic-table td,
.final-field, .completion-row, .completion-field, .observation-title {
  border-color: #000 !important;
}

img { max-width: 100% !important; height: auto !important; }
a { color: #000 !important; text-decoration: none !important; }
p { orphans: 3; widows: 3; }
.no-print { display: none !important; }
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

function derivarCategoria(disciplina: string): string {
  const s = (disciplina || '').toLowerCase();
  if (s.includes('optativa')) return 'Natureza - Optativa';
  return 'Natureza - Obrigatória';
}

function derivarAtividade(disciplina: string): string {
  const s = (disciplina || '').toLowerCase();
  if (s.includes('prática') || s.includes('pratica')) return 'Prática';
  if (s.includes('estágio') || s.includes('estagio')) return 'Estágio';
  return 'Teórica';
}

function mapearSituacao(status: string | null | undefined): string {
  const s = (status || '').toUpperCase().trim();
  if (s === 'AP' || s === 'APROVADO') return 'Aprovado';
  if (s === 'REP' || s === 'REPROVADO') return 'Reprovado';
  if (s === 'CUMP' || s === 'CUMPRIDA') return 'Cumprida';
  if (s === 'MAT' || s === 'MATRICULADO') return 'Matriculado';
  if (s === 'TRANC' || s === 'TRANCADO') return 'Trancado';
  return status || '';
}

// ============================================================
// Renderizadores parciais
// ============================================================

function renderHeader(faculdade: FaculdadeInfo, logoDataUrl: string | null): string {
  const logoImg = logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : '';
  const authText = faculdade.registroRtd || '';
  const authParas = authText
    ? `<p>${esc(authText)}</p>`
    : '';
  return `<header class="institution-header">
    <div class="institution-logo">${logoImg}</div>
    <div class="institution-info">
      <h1>${esc(faculdade.nome)}</h1>
      ${authParas}
      <h2>Histórico Acadêmico</h2>
    </div>
  </header>`;
}

function renderSchoolRecord(
  aluno: Aluno,
  faculdade: FaculdadeInfo,
  cursoInfo: CursoInfo | null,
): string {
  const { titulo } = obterTituloCurso(cursoInfo, aluno);
  const regulatory = cursoInfo?.regulatory || faculdade.registroRtd || '';
  const chTotal = cursoInfo?.nome && CH_TOTAL_EXIGIDA[aluno.curso || '']
    ? fmtNum(CH_TOTAL_EXIGIDA[aluno.curso || ''])
    : '';
  const ingresso = aluno.forma_ingresso || 'Vestibular';

  return `<section class="school-record">
    <div class="record-title">HISTÓRICO ESCOLAR</div>
    <div class="student-information">
      <div class="student-row">
        <div class="student-field"><strong>Aluno(a):</strong><span>${esc(aluno.nome || '')}</span></div>
        <div class="student-field"><strong>CPF:</strong><span>${esc(aluno.cpf || '')}</span></div>
      </div>
      <div class="student-row">
        <div class="student-field"><strong>Matrícula:</strong><span>${esc(aluno.matricula || '')}</span></div>
        <div class="student-field"><strong>Data de Nascimento:</strong><span>${esc(formatarDataOuVazio(aluno.data_nascimento))}</span></div>
        <div class="student-field"><strong>Sexo:</strong><span>${esc(aluno.sexo || '')}</span></div>
      </div>
      <div class="student-row">
        <div class="student-field"><strong>Nacionalidade:</strong><span>${esc(aluno.nacionalidade || 'Brasileiro')}</span></div>
        <div class="student-field"><strong>R.G.:</strong><span>${esc(aluno.rg || '')}</span></div>
        <div class="student-field"><strong>Naturalidade:</strong><span>${esc(aluno.naturalidade || '')}</span></div>
      </div>
    </div>
    <div class="degree-information">
      <p><strong>Título:</strong> <strong>${esc(titulo)}</strong></p>
    </div>
    <div class="course-information">
      <p><strong>Informação do Curso:</strong></p>
      <p>${esc(regulatory)}</p>
      <p><strong>Forma de Ingresso:</strong> ${esc(ingresso)}</p>
      ${chTotal ? `<p><strong>Carga Horária Total:</strong> ${chTotal}</p>` : ''}
    </div>
  </section>`;
}

function renderTabela(disciplinas: HistoricoDisciplina[]): string {
  const periodos: string[] = [];
  for (const d of disciplinas) if (!periodos.includes(d.periodo)) periodos.push(d.periodo);
  periodos.sort();

  let body = '';
  periodos.forEach((periodo, idx) => {
    const discs = disciplinas.filter((d) => d.periodo === periodo);
    if (!discs.length) return;
    body += `<tr class="semester-header"><td colspan="8">${idx + 1}º Semestre</td></tr>`;
    for (const d of discs) {
      body += `<tr>
        <td>${esc(periodo)}</td>
        <td>${esc(d.disciplina || '')}</td>
        <td>${esc(derivarCategoria(d.disciplina || ''))}</td>
        <td>${esc(derivarAtividade(d.disciplina || ''))}</td>
        <td>${esc(d.ch || '')}</td>
        <td>${esc(d.ft || '')}</td>
        <td>${esc(d.nota || '')}</td>
        <td>${esc(mapearSituacao(d.status))}</td>
      </tr>`;
    }
  });

  return `<table class="academic-table">
    <thead>
      <tr>
        <th>Período</th>
        <th>Componentes Curriculares</th>
        <th>Categoria</th>
        <th>Atividade<br>Pedagógica</th>
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

function renderSignature(
  assinaturaImgDataUrl: string | null,
  nomeSignatario: string,
  cargoSignatario: string,
): string {
  const assImg = assinaturaImgDataUrl
    ? `<img class="signature-img" src="${assinaturaImgDataUrl}" alt="">`
    : '';
  return `<section class="signature">
    ${assImg}
    <div class="signature-line"></div>
    <div class="signature-name">${esc(nomeSignatario)}</div>
    <div class="signature-role">${esc(cargoSignatario)}</div>
  </section>`;
}

function renderFinalInfo(
  disciplinas: HistoricoDisciplina[],
  cursoKey: string,
): string {
  const isEstagio = (d: HistoricoDisciplina) =>
    /EST[ÁA]GIO/i.test(d.disciplina || '');
  const isAtividade = (d: HistoricoDisciplina) =>
    /ATIVIDADES?\s+COMPLEMENTARES/i.test(d.disciplina || '');
  const chEstagio = disciplinas.filter(isEstagio).reduce((s, d) => s + parseCh(d.ch), 0);
  const chAtividade = disciplinas.filter(isAtividade).reduce((s, d) => s + parseCh(d.ch), 0);
  const chCursada = disciplinas.reduce((s, d) => s + parseCh(d.ch), 0);
  const chExigida = CH_TOTAL_EXIGIDA[cursoKey] ?? 0;

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
  const cr = crPeso > 0 ? (crNum / crPeso).toFixed(2).replace('.', ',') : '';

  return `<section class="final-academic-information">
    <div class="final-field"><strong>Estágio Curricular</strong><span>${chEstagio || ''}H</span></div>
    <div class="final-field"><strong>CH Atividades Complementares</strong><span>${chAtividade || ''}H</span></div>
    <div class="final-field"><strong>CH Total Cursada</strong><span>${chCursada || ''}H</span></div>
    <div class="final-field"><strong>CH Total Exigida</strong><span>${chExigida ? fmtNum(chExigida) + 'H' : ''}</span></div>
    <div class="final-field"><strong>Coeficiente de Rendimento</strong><span>${esc(cr)}</span></div>
  </section>`;
}

function renderCompletion(aluno: Aluno, cursoInfo: CursoInfo | null): string {
  const { tituloObtido } = obterTituloCurso(cursoInfo, aluno);
  const isFormado = aluno.ano_conclusao && aluno.ano_conclusao !== 'Cursando';
  const status = !aluno.ano_conclusao ? '—' : isFormado ? 'Formado(a)' : 'Cursando';
  const dataConclusao = isFormado ? formatarDataOuVazio(aluno.ano_conclusao) : '';
  const dataColacao = formatarDataOuVazio(aluno.data_colacao);
  return `<section class="completion-information">
    <div class="completion-row">
      <div class="completion-field"><strong>Status:</strong><span>${esc(status)}</span></div>
    </div>
    <div class="completion-row">
      <div class="completion-field"><strong>Data de Conclusão de Curso:</strong><span>${esc(dataConclusao)}</span></div>
      <div class="completion-field"><strong>Data de Colação de Grau:</strong><span>${esc(dataColacao)}</span></div>
      <div class="completion-field"><strong>Título Obtido:</strong><span>${esc(tituloObtido)}</span></div>
    </div>
  </section>`;
}

function renderObservation(faculdade: FaculdadeInfo): string {
  return `<section class="observation">
    <div class="observation-title">OBSERVAÇÃO:</div>
    <div class="observation-content">
      <p>${esc(faculdade.rodape || '')}</p>
    </div>
  </section>`;
}

function renderVerificacao(
  codigoVerificacao: string,
  qrDataUrl: string | null,
  emitidoEm: string,
): string {
  const verImg = qrDataUrl ? `<img src="${qrDataUrl}" alt="">` : '';
  return `<div class="verificacao">
    ${verImg}
    <p>Código de verificação: ${esc(codigoVerificacao)}</p>
    <p>Escaneie o QR Code para validar em qualquer dispositivo.</p>
    <p>Emitido em ${esc(formatarDataHoraBrasilia(emitidoEm))} (horário de Brasília)</p>
  </div>`;
}

// ============================================================
// Geração do HTML
// ============================================================

interface DoisDeJulhoHtmlOpts {
  aluno: Aluno;
  disciplinas: HistoricoDisciplina[];
  faculdade: FaculdadeInfo;
  cursoInfo: CursoInfo | null;
  codigoVerificacao: string;
  qrDataUrl: string | null;
  logoDataUrl: string | null;
  assinaturaImgDataUrl: string | null;
  nomeSignatario: string;
  cargoSignatario: string;
  emitidoEm: string;
}

export function gerarHtmlDoisDeJulho(opts: DoisDeJulhoHtmlOpts): string {
  const {
    aluno,
    disciplinas,
    faculdade,
    cursoInfo,
    codigoVerificacao,
    qrDataUrl,
    logoDataUrl,
    assinaturaImgDataUrl,
    nomeSignatario,
    cargoSignatario,
    emitidoEm,
  } = opts;

  const cursoKey = aluno.curso || '';

  // PÁGINA 1 — cabeçalho + histórico escolar + tabela
  const pagina1 = `<div class="page">
    ${renderHeader(faculdade, logoDataUrl)}
    ${renderSchoolRecord(aluno, faculdade, cursoInfo)}
    ${renderTabela(disciplinas)}
  </div>`;

  // PÁGINA 2 — assinatura + informações finais + conclusão + observação + verificação
  const pagina2 = `<div class="page-break"></div>
  <div class="page">
    ${renderSignature(assinaturaImgDataUrl, nomeSignatario, cargoSignatario)}
    ${renderFinalInfo(disciplinas, cursoKey)}
    ${renderCompletion(aluno, cursoInfo)}
    ${renderObservation(faculdade)}
    ${renderVerificacao(codigoVerificacao, qrDataUrl, emitidoEm)}
  </div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Histórico Escolar - ${esc(faculdade.nome)}</title>
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

export interface DoisDeJulhoRenderOpts {
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

export async function renderHtmlDoisDeJulhoPdf(opts: DoisDeJulhoRenderOpts): Promise<void> {
  const {
    aluno,
    disciplinas,
    faculdade,
    cursoInfo,
    destinoPath,
    codigoVerificacao,
    qrBuffer,
    semAssinatura,
    emitidoEm,
  } = opts;

  const qrDataUrl = qrBuffer ? `data:image/png;base64,${qrBuffer.toString('base64')}` : null;

  let logoDataUrl: string | null = null;
  if (faculdade.logoPath && fs.existsSync(faculdade.logoPath)) {
    try {
      const buf = fs.readFileSync(faculdade.logoPath);
      logoDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
    } catch {
      logoDataUrl = null;
    }
  }

  let assinaturaImgDataUrl: string | null = null;
  const assinatura = getAssinaturaAtiva();
  const nomeSignatario = (assinatura?.nome_signatario || faculdade.diretor || 'Prof. Dr. José Augusto Maciel Torres').toUpperCase();
  const cargoSignatario = (assinatura?.cargo || faculdade.cargoDiretor || 'Diretor Geral').toUpperCase();
  if (!semAssinatura && assinatura?.imagem_path && fs.existsSync(assinatura.imagem_path)) {
    try {
      const buf = fs.readFileSync(assinatura.imagem_path);
      assinaturaImgDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
    } catch {
      assinaturaImgDataUrl = null;
    }
  }

  const html = gerarHtmlDoisDeJulho({
    aluno,
    disciplinas,
    faculdade,
    cursoInfo,
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
