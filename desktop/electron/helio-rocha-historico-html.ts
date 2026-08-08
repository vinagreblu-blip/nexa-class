import fs from 'node:fs';
import type { Aluno, HistoricoDisciplina } from './types';
import type { CursoInfo, FaculdadeInfo } from './faculdades';
import { getAssinaturaAtiva } from './ipc/assinatura';
import { formatarDataHoraBrasilia } from './utils';
import { renderizarHtmlParaPdf } from './faciip-historico-html';

export const STYLE_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --page-width: 210mm;
  --page-height: 297mm;
  --border-color: #111;
  --header-gray: #b7b7b7;
  --text-color: #111;
  --font: Arial, Helvetica, sans-serif;
}
body {
  background: #fff;
  color: var(--text-color);
  font-family: var(--font);
  font-size: 9px;
  line-height: 1.2;
}
.page {
  position: relative;
  width: var(--page-width);
  min-height: var(--page-height);
  margin: 0 auto 20px;
  padding: 3.5mm;
  background: #fff;
  border: 1px solid var(--border-color);
  overflow: visible;
}
.header { width: 100%; margin-bottom: 7px; }
.header-main { display: flex; align-items: flex-start; width: 100%; }
.institution-logo { width: 42mm; min-width: 42mm; height: 22mm; }
.institution-logo img { display: block; width: 100%; height: 100%; object-fit: contain; }
.header-title { padding-left: 4mm; padding-top: 0.5mm; }
.header-title h1 { font-size: 20px; line-height: 1; font-weight: 700; }
.header-title h2 { margin-top: 7px; font-size: 12px; line-height: 1; font-weight: 700; }
.institution-contact { width: 100%; text-align: center; margin-top: 3px; font-size: 7px; line-height: 1.25; }
.institution-contact p { margin-bottom: 1px; }
.institution-contact em { font-style: italic; }
.student-grid {
  display: grid;
  grid-template-columns: 19% 57% 15% 9%;
  width: 100%;
  border-top: 1px solid var(--border-color);
  border-left: 1px solid var(--border-color);
  margin-top: 5px;
}
.student-grid.second-row {
  grid-template-columns: 25% 26% 25% 24%;
  margin-top: 0;
}
.field {
  min-height: 12mm;
  border-right: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
}
.field label {
  display: block;
  padding: 2px 3px;
  font-size: 8px;
  line-height: 1;
  font-weight: 700;
  text-transform: uppercase;
}
.field-value {
  min-height: 6mm;
  padding: 2px 4px;
  font-size: 9px;
  line-height: 1.2;
}
.course-grid {
  display: grid;
  grid-template-columns: 34% 16% 50%;
  width: 100%;
  border-top: 1px solid var(--border-color);
  border-left: 1px solid var(--border-color);
  margin-top: 6px;
}
.course-field {
  min-height: 26mm;
  border-right: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
}
.course-field label {
  display: block;
  padding: 2px 3px;
  font-size: 8px;
  font-weight: 700;
  text-transform: uppercase;
}
.course-content {
  padding: 6px 5px;
  font-size: 10px;
  line-height: 1.3;
}
.course-content strong {
  display: block;
  margin-bottom: 5px;
  font-size: 11px;
}
.shift .course-content { text-align: center; font-size: 10px; }
.regulatory .course-content { font-size: 8.5px; line-height: 1.35; }
.regulatory .course-content p { margin-bottom: 5px; }
.academic-grid {
  display: grid;
  grid-template-columns: 22% 15% 20% 22% 21%;
  width: 100%;
  border-top: 1px solid var(--border-color);
  border-left: 1px solid var(--border-color);
  margin-top: 6px;
}
.academic-field {
  min-height: 13mm;
  border-right: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
}
.academic-field label {
  display: block;
  padding: 2px 3px;
  font-size: 7.5px;
  font-weight: 700;
  line-height: 1.1;
  text-transform: uppercase;
}
.academic-value {
  min-height: 7mm;
  padding: 5px 4px;
  font-size: 10px;
}
.academic-value.status {
  font-size: 15px;
  font-weight: 700;
  text-align: center;
  padding-top: 3px;
}
.enade-bar {
  width: 58%;
  min-height: 8mm;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 5px;
  background: var(--header-gray);
  border-left: 1px solid var(--border-color);
  border-right: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  font-size: 9px;
}
.enade-bar strong { font-size: 11px; }
.enade-bar span { font-size: 8.5px; }
.page-break { display: block; width: 100%; height: 0; page-break-after: always; break-after: page; }
.academic-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  margin-top: 0;
  font-size: 8.5px;
}
.academic-table thead th {
  height: 6mm;
  padding: 2px 3px;
  border: 1px solid var(--border-color);
  background: var(--header-gray);
  text-align: center;
  vertical-align: middle;
  font-size: 9px;
  font-weight: 400;
  line-height: 1;
  text-transform: uppercase;
}
.academic-table th:nth-child(1), .academic-table td:nth-child(1) { width: 9%; }
.academic-table th:nth-child(2), .academic-table td:nth-child(2) { width: 37%; }
.academic-table th:nth-child(3), .academic-table td:nth-child(3) { width: 28%; }
.academic-table th:nth-child(4), .academic-table td:nth-child(4) { width: 13%; }
.academic-table th:nth-child(5), .academic-table td:nth-child(5) { width: 6%; }
.academic-table th:nth-child(6), .academic-table td:nth-child(6) { width: 4%; }
.academic-table th:nth-child(7), .academic-table td:nth-child(7) { width: 5%; }
.academic-table tbody td {
  height: 4.3mm;
  padding: 1.5px 4px;
  border: 1px solid var(--border-color);
  vertical-align: middle;
  line-height: 1.05;
}
.academic-table tbody td:nth-child(2) { text-align: left; font-style: italic; font-size: 8.5px; }
.academic-table tbody td:nth-child(3) { text-align: center; font-style: italic; font-size: 7.8px; }
.academic-table tbody td:nth-child(4) { text-align: center; font-style: italic; font-size: 7.8px; }
.academic-table tbody td:nth-child(5), .academic-table tbody td:nth-child(6), .academic-table tbody td:nth-child(7) { text-align: center; }
.academic-table .period-cell {
  text-align: center;
  vertical-align: middle;
  font-style: normal;
  font-size: 9px;
}
.academic-table .period-start { height: 4.3mm; }
.academic-table .period-start:not(:first-child) td { border-top: 1px solid var(--border-color); }
.academic-table .period-total td {
  height: 4.5mm;
  padding: 1px 3px;
  font-weight: 700;
  font-style: normal;
  font-size: 7.8px;
}
.academic-table .period-total td:first-child { border-right: none; }
.academic-table .period-total td:nth-child(2) { border-left: none; }
.academic-summary {
  width: 70%;
  margin: 7mm auto 0;
}
.summary-header {
  display: grid;
  grid-template-columns: 50% 50%;
  width: 100%;
  min-height: 6mm;
}
.summary-header > div {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color);
  font-size: 8px;
  font-weight: 700;
  line-height: 1.1;
}
.summary-value { text-align: center; min-height: 6mm; font-size: 10px; }
.activities-summary {
  width: 53%;
  margin: 4mm 0 0 19%;
}
.activities-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.activities-table th:nth-child(1), .activities-table td:nth-child(1) { width: 25%; }
.activities-table th:nth-child(2), .activities-table td:nth-child(2) { width: 27%; }
.activities-table th:nth-child(3), .activities-table td:nth-child(3) { width: 28%; }
.activities-table th:nth-child(4), .activities-table td:nth-child(4) { width: 20%; }
.activities-table th {
  height: 11mm;
  padding: 3px;
  border: 1px solid var(--border-color);
  background: #fff;
  text-align: center;
  vertical-align: middle;
  font-size: 7.5px;
  font-weight: 700;
  line-height: 1.15;
}
.activities-table tbody td {
  height: 8mm;
  padding: 3px;
  border: 1px solid var(--border-color);
  text-align: center;
  vertical-align: middle;
  font-size: 8px;
}
.academic-observations {
  width: 70%;
  margin: 6mm auto 0;
}
.observations-title {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  margin-bottom: 4px;
  padding: 2px 4px;
  border: 1px solid var(--border-color);
  border-bottom: none;
}
.observations-content {
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  font-size: 9px;
  line-height: 1.4;
  text-align: justify;
}
.observations-content p { margin-bottom: 5px; }
.degree-summary {
  width: 70%;
  margin: 5mm auto 0;
}
.degree-field {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border-color);
}
.degree-label {
  font-size: 8px;
  font-weight: 700;
  text-transform: uppercase;
  white-space: nowrap;
}
.degree-value {
  font-size: 10px;
  font-weight: 700;
}
.signature {
  width: 55%;
  margin: 20mm auto 0;
  text-align: center;
}
.signature-img { display: block; width: 238px; margin: 0 auto 4px; }
.signature-line { width: 65%; margin: 0 auto 3px; border-top: 1px solid #000; }
.signature-name { font-size: 12px; font-weight: 700; line-height: 1.1; }
.signature-role { margin-top: 3px; font-size: 9px; font-weight: 700; }
.footer {
  width: 80%;
  margin: 12mm auto 0;
  padding: 5px 8px;
  border: 1px solid var(--border-color);
  text-align: center;
  font-size: 8px;
  line-height: 1.35;
}
.footer p { margin: 0; }
.verificacao { margin-top: 10mm; text-align: center; }
.verificacao img { width: 70px; }
.verificacao p { font-size: 8px; margin-top: 2px; }
`;

export const PRINT_CSS = `
@page { size: A4 portrait; margin: 0; }
html, body { width: 210mm; margin: 0; padding: 0; background: #fff !important; }
body { font-family: Arial, Helvetica, sans-serif; color: #111; }
* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-shadow: none !important; text-shadow: none !important; }
.page {
  width: 210mm !important;
  min-height: auto !important;
  margin: 0 !important;
  padding: 3.5mm !important;
  background: #fff !important;
  border: none !important;
  overflow: visible !important;
}
.page-break { display: block; page-break-after: always; break-after: page; }
.header { page-break-inside: avoid; break-inside: avoid; }
.student-grid { page-break-inside: avoid; break-inside: avoid; }
.course-grid { page-break-inside: avoid; break-inside: avoid; }
.academic-grid { page-break-inside: avoid; break-inside: avoid; }
.enade-bar { page-break-inside: avoid; break-inside: avoid; }
.academic-table { width: 100% !important; page-break-inside: auto; break-inside: auto; }
.academic-table thead { display: table-header-group; }
.academic-table tr { page-break-inside: avoid !important; break-inside: avoid !important; }
.academic-table th, .academic-table td { page-break-inside: avoid; break-inside: avoid; border-color: #111 !important; }
.academic-table thead th { background: #b7b7b7 !important; }
.academic-table .period-total { page-break-inside: avoid !important; break-inside: avoid !important; }
.academic-summary, .activities-summary, .academic-observations, .degree-summary, .signature, .footer, .verificacao { page-break-inside: avoid; break-inside: avoid; }
.enade-bar { background: #b7b7b7 !important; }
.activities-table th, .activities-table td { border-color: #111 !important; }
img { max-width: 100%; page-break-inside: avoid; break-inside: avoid; }
a { color: inherit !important; text-decoration: none !important; }
p { orphans: 3; widows: 3; }
.no-print { display: none !important; }
`;

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

function renderHeader(faculdade: FaculdadeInfo, logoDataUrl: string | null): string {
  const logoImg = logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : '';
  return `<header class="header">
    <div class="header-main">
      <div class="institution-logo">${logoImg}</div>
      <div class="header-title">
        <h1>HISTÓRICO ACADÊMICO</h1>
        <h2>${esc(faculdade.nome)}</h2>
      </div>
    </div>
    <div class="institution-contact">
      <p>CNPJ ${esc(faculdade.cnpj)} / E-mail.: <span class="email">${esc(faculdade.email)}</span> / ${esc(faculdade.telefone)}</p>
      <p>ENDEREÇO: ${esc(faculdade.endereco)}</p>
    </div>
  </header>`;
}

function renderStudentGrid(aluno: Aluno): string {
  return `<section class="student-grid">
    <div class="field cga"><label>CGA</label><div class="field-value">${esc(aluno.matricula || '')}</div></div>
    <div class="field student-name"><label>NOME DO ALUNO</label><div class="field-value">${esc(aluno.nome || '')}</div></div>
    <div class="field gender"><label>SEXO</label><div class="field-value">${esc(aluno.sexo || '')}</div></div>
    <div class="field birth"><label>DATA DE NASC</label><div class="field-value">${esc(formatarDataOuVazio(aluno.data_nascimento))}</div></div>
  </section>
  <section class="student-grid second-row">
    <div class="field"><label>NATURALIDADE</label><div class="field-value">${esc(aluno.naturalidade || '')}</div></div>
    <div class="field"><label>RG</label><div class="field-value">${esc(aluno.rg || '')}</div></div>
    <div class="field"><label>ÓRGÃO EMISSOR</label><div class="field-value">${esc(aluno.orgao_emissor || '')}</div></div>
    <div class="field"><label>CPF</label><div class="field-value">${esc(aluno.cpf || '')}</div></div>
  </section>`;
}

function renderRegulatorio(regulatory: string): string {
  const text = regulatory.trim();
  if (!text) return '';
  const sentences = text.split(/\.\s+/).filter((s) => s.trim());
  if (sentences.length <= 1) return `<p>${esc(text)}</p>`;
  return sentences.map((s) => `<p>${esc(s.trim())}${s.trim().endsWith('.') ? '' : '.'}</p>`).join('');
}

function renderCourseGrid(aluno: Aluno, cursoInfo: CursoInfo | null): string {
  const nomeCurso = cursoInfo?.nome || aluno.curso || '';
  const codEmec = cursoInfo?.codEmec?.trim() || '';
  const turno = cursoInfo?.turno || aluno.turno || '';
  const regulatory = cursoInfo?.regulatory || '';
  return `<section class="course-grid">
    <div class="course-field course-name">
      <label>CURSO</label>
      <div class="course-content">
        <strong>${esc(nomeCurso)}</strong>
        ${codEmec ? `<strong>COD. EMEC: ${esc(codEmec)}</strong>` : ''}
      </div>
    </div>
    <div class="course-field shift">
      <label>TURNO</label>
      <div class="course-content">${esc(turno)}</div>
    </div>
    <div class="course-field regulatory">
      <label>REGULATÓRIO</label>
      <div class="course-content">${renderRegulatorio(regulatory)}</div>
    </div>
  </section>`;
}

function renderAcademicGrid(aluno: Aluno): string {
  const isFormado = aluno.ano_conclusao && aluno.ano_conclusao !== 'Cursando';
  const situacao = isFormado ? 'GRADUADO' : 'CURSANDO';
  const dataConclusao = isFormado ? formatarDataOuVazio(aluno.ano_conclusao) : '';
  const dataColacao = formatarDataOuVazio(aluno.data_colacao);
  return `<section class="academic-grid">
    <div class="academic-field"><label>FORMA DE INGRESSO</label><div class="academic-value">${esc(aluno.forma_ingresso || 'Vestibular')}</div></div>
    <div class="academic-field"><label>DATA VESTIBULAR</label><div class="academic-value">${esc(formatarDataOuVazio(aluno.data_vestibular))}</div></div>
    <div class="academic-field"><label>SITUAÇÃO ATUAL</label><div class="academic-value status">${esc(situacao)}</div></div>
    <div class="academic-field"><label>DATA DA CONCLUSÃO DO CURSO</label><div class="academic-value">${esc(dataConclusao)}</div></div>
    <div class="academic-field"><label>DATA DA COLAÇÃO DE GRAU</label><div class="academic-value">${esc(dataColacao)}</div></div>
  </section>`;
}

function renderEnadeBar(faculdade: FaculdadeInfo): string {
  return `<section class="enade-bar">
    <strong>ENADE:</strong>
    <span>${esc(faculdade.enade || 'Aluno dispensado de acordo com o Calendário Trienal')}</span>
  </section>`;
}

function renderTabela(disciplinas: HistoricoDisciplina[]): string {
  const periodos: string[] = [];
  for (const d of disciplinas) if (!periodos.includes(d.periodo)) periodos.push(d.periodo);
  periodos.sort();

  let body = '';
  for (const periodo of periodos) {
    const discs = disciplinas.filter((d) => d.periodo === periodo);
    if (!discs.length) continue;
    const chTotal = discs.reduce((s, d) => s + parseCh(d.ch), 0);

    discs.forEach((d, i) => {
      const rowClass = i === 0 ? ' class="period-start"' : '';
      const cellClass = i === 0 ? ' class="period-cell"' : '';
      const periodoVal = i === 0 ? esc(periodo) : '';
      body += `<tr${rowClass}>
        <td${cellClass}>${periodoVal}</td>
        <td>${esc(d.disciplina || '')}</td>
        <td>${esc(d.docente || '')}</td>
        <td>${esc(d.titulacao || '')}</td>
        <td>${esc(d.ch || '')}</td>
        <td>${esc(d.nota || '')}</td>
        <td>${esc(d.status || '')}</td>
      </tr>`;
    });

    body += `<tr class="period-total">
      <td colspan="4">TOTAIS DO PERÍODO</td>
      <td>${chTotal || ''}H</td>
      <td></td>
      <td></td>
    </tr>`;
  }

  return `<table class="academic-table">
    <thead>
      <tr>
        <th>PERIODO</th>
        <th>DISCIPLINA</th>
        <th>DOCENTES</th>
        <th>TITULAÇÃO</th>
        <th>CH</th>
        <th>N/C</th>
        <th>STC</th>
      </tr>
    </thead>
    <tbody>
      ${body}
    </tbody>
  </table>`;
}

function renderSummary(disciplinas: HistoricoDisciplina[]): string {
  const chTotal = disciplinas.reduce((s, d) => s + parseCh(d.ch), 0);
  const notas = disciplinas.map((d) => parseNota(d.nota)).filter((n): n is number => n !== null);
  const media = notas.length ? (notas.reduce((s, n) => s + n, 0) / notas.length).toFixed(1) : '';
  return `<section class="academic-summary">
    <div class="summary-header">
      <div>CARGA HORÁRIA TOTAL</div>
      <div>MÉDIA GERAL</div>
      <div class="summary-value">${chTotal || ''}H</div>
      <div class="summary-value">${media}</div>
    </div>
  </section>`;
}

function renderActivities(disciplinas: HistoricoDisciplina[]): string {
  const isAtividade = (d: HistoricoDisciplina) => /ATIVIDADES?\s+COMPLEMENTARES/i.test(d.disciplina || '');
  const isEstagio = (d: HistoricoDisciplina) => /EST[ÁA]GIO\s+SUPERVISIONADO/i.test(d.disciplina || '');
  const chAtividade = disciplinas.filter(isAtividade).reduce((s, d) => s + parseCh(d.ch), 0);
  const chEstagio = disciplinas.filter(isEstagio).reduce((s, d) => s + parseCh(d.ch), 0);
  const chCurso = disciplinas.filter((d) => !isAtividade(d) && !isEstagio(d)).reduce((s, d) => s + parseCh(d.ch), 0);
  return `<section class="activities-summary">
    <table class="activities-table">
      <thead>
        <tr>
          <th>DO CURSO</th>
          <th>ATIVIDADE<br>COMPLEMENTAR</th>
          <th>ESTÁGIO<br>CURRICULAR<br>SUPERVISIONADO</th>
          <th>CUMPRIDA</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${chCurso || ''}H</td>
          <td>${chAtividade || ''}H</td>
          <td>${chEstagio || ''}H</td>
          <td></td>
        </tr>
      </tbody>
    </table>
  </section>`;
}

function renderObservations(aluno: Aluno): string {
  const isFormado = aluno.ano_conclusao && aluno.ano_conclusao !== 'Cursando';
  const situacao = isFormado ? 'GRADUADO' : 'CURSANDO';
  return `<section class="academic-observations">
    <div class="observations-title">OBSERVAÇÕES</div>
    <div class="observations-content">
      <p>Declaro, para os devidos fins, que o(a) aluno(a) acima identificado(a) cumpriu os requisitos acadêmicos previstos para conclusão do curso.</p>
      <p>Situação atual: <strong>${esc(situacao)}</strong></p>
    </div>
  </section>`;
}

function renderDegree(cursoInfo: CursoInfo | null, aluno: Aluno): string {
  const nomeCurso = cursoInfo?.nome || aluno.curso || '';
  const titulo = nomeCurso.replace(/^Bacharelado em\s*/i, 'Bacharel em ') || 'Bacharel';
  return `<section class="degree-summary">
    <div class="degree-field">
      <span class="degree-label">TÍTULO OBTIDO</span>
      <span class="degree-value">${esc(titulo)}</span>
    </div>
  </section>`;
}

function renderSignature(
  faculdade: FaculdadeInfo,
  assinaturaImgDataUrl: string | null,
  nomeSignatario: string,
  cargoSignatario: string,
): string {
  const assImg = assinaturaImgDataUrl ? `<img class="signature-img" src="${assinaturaImgDataUrl}" alt="">` : '';
  return `<section class="signature">
    ${assImg}
    <div class="signature-line"></div>
    <div class="signature-name">${esc(nomeSignatario)}</div>
    <div class="signature-role">${esc(cargoSignatario)}</div>
  </section>`;
}

function renderFooter(faculdade: FaculdadeInfo): string {
  return `<footer class="footer">
    <p>${esc(faculdade.rodape)}</p>
  </footer>`;
}

function renderVerificacao(codigoVerificacao: string, qrDataUrl: string | null, emitidoEm: string): string {
  const verImg = qrDataUrl ? `<img src="${qrDataUrl}" alt="">` : '';
  return `<div class="verificacao">
    ${verImg}
    <p>Código de verificação: ${esc(codigoVerificacao)}</p>
    <p>Escaneie o QR Code para validar em qualquer dispositivo.</p>
    <p>Emitido em ${esc(formatarDataHoraBrasilia(emitidoEm))} (horário de Brasília)</p>
  </div>`;
}

interface HelioRochaHtmlOpts {
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

function gerarHtmlHelioRocha(opts: HelioRochaHtmlOpts): string {
  const { aluno, disciplinas, faculdade, cursoInfo, codigoVerificacao, qrDataUrl, logoDataUrl, assinaturaImgDataUrl, nomeSignatario, cargoSignatario, emitidoEm } = opts;

  const pagina1 = `<div class="page">
    ${renderHeader(faculdade, logoDataUrl)}
    ${renderStudentGrid(aluno)}
    ${renderCourseGrid(aluno, cursoInfo)}
    ${renderAcademicGrid(aluno)}
    ${renderEnadeBar(faculdade)}
    ${renderTabela(disciplinas)}
  </div>`;

  const pagina2 = `<div class="page-break"></div>
  <div class="page">
    ${renderSummary(disciplinas)}
    ${renderActivities(disciplinas)}
    ${renderObservations(aluno)}
    ${renderDegree(cursoInfo, aluno)}
    ${renderSignature(faculdade, assinaturaImgDataUrl, nomeSignatario, cargoSignatario)}
    ${renderFooter(faculdade)}
    ${renderVerificacao(codigoVerificacao, qrDataUrl, emitidoEm)}
  </div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Histórico Acadêmico - ${esc(faculdade.nome)}</title>
  <style>${STYLE_CSS}</style>
  <style media="print">${PRINT_CSS}</style>
</head>
<body>
${pagina1}
${pagina2}
</body>
</html>`;
}

export interface HelioRochaRenderOpts {
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

export async function renderHtmlHelioRochaPdf(opts: HelioRochaRenderOpts): Promise<void> {
  const { aluno, disciplinas, faculdade, cursoInfo, destinoPath, codigoVerificacao, qrBuffer, semAssinatura, emitidoEm } = opts;

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
  const nomeSignatario = (assinatura?.nome_signatario || faculdade.diretor || 'Prof. Dr. José Augusto Maciel Torres');
  const cargoSignatario = (assinatura?.cargo || faculdade.cargoDiretor || 'Diretor Geral');
  if (!semAssinatura && assinatura?.imagem_path && fs.existsSync(assinatura.imagem_path)) {
    try {
      const buf = fs.readFileSync(assinatura.imagem_path);
      assinaturaImgDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
    } catch {
      assinaturaImgDataUrl = null;
    }
  }

  const html = gerarHtmlHelioRocha({
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
