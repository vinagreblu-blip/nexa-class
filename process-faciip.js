'use strict';
const fs = require('fs');

const DB_PATH = 'C:/dev/pessoal/universidade-app/desktop/electron/database.ts';
const DOC_FILES = [
  { key: 'admhosp',      label: 'Administração Hospitalar',                constName: 'HISTORICO_PADRAO_FACIIP_ADM_HOSPITALAR',  file: 'C:/Users/vinag/AppData/Local/Temp/opencode/admhosp/ex/word/document.xml' },
  { key: 'comsocialrp',  label: 'Comunicação Social (Relações Públicas)',  constName: 'HISTORICO_PADRAO_FACIIP_COM_SOCIAL_RP',   file: 'C:/Users/vinag/AppData/Local/Temp/opencode/comsocialrp/ex/word/document.xml' },
  { key: 'contabeis',    label: 'Ciências Contábeis',                      constName: 'HISTORICO_PADRAO_FACIIP_CONTABEIS',       file: 'C:/Users/vinag/AppData/Local/Temp/opencode/contabeis/ex/word/document.xml' },
  { key: 'engprodmec',   label: 'Engenharia de Produção Mecânica',         constName: 'HISTORICO_PADRAO_FACIIP_ENG_PRODUCAO_MEC', file: 'C:/Users/vinag/AppData/Local/Temp/opencode/engprodmec/ex/word/document.xml' },
  { key: 'jornalismo',   label: 'Jornalismo',                              constName: 'HISTORICO_PADRAO_FACIIP_JORNALISMO',      file: 'C:/Users/vinag/AppData/Local/Temp/opencode/jornalismo/ex/word/document.xml' },
  { key: 'pedagogia',    label: 'Pedagogia',                               constName: 'HISTORICO_PADRAO_FACIIP_PEDAGOGIA',       file: 'C:/Users/vinag/AppData/Local/Temp/opencode/pedagogia/ex/word/document.xml' },
  { key: 'turismofacii', label: 'Turismo e Hotelaria',                     constName: 'HISTORICO_PADRAO_FACIIP_TURISMO_HOTELARIA', file: 'C:/Users/vinag/AppData/Local/Temp/opencode/turismofacii/ex/word/document.xml' },
];

// ---------- helpers ----------
function stripAcc(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}
function collapseWs(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

const ALIAS = {
  'JOSÉ NILTON SANTANA DO SANTOS': 'JOSÉ NILTON SANTANA DOS SANTOS',
  'PAULA GOIS DE LIMA': 'PAULA GOIS LIMA',
  'JONAS FERNANDES GUEDES NOGUEIRA AMRQUES': 'JONAS FERNANDES GUEDES N. MARQUES',
  'CARLOS ANTONIO CABRAL CORDEIRO CALADO': 'CARLOS ANTÔNIO C. C. CALADO',
  'DAIANA COUTO COELHO': 'DIANA COUTO COELHO',
  'CINTIA MORENO DE MORAES': 'CINTIA MORENO MORAES',
  'RENILDO ROBERTO SANTOS': 'RENILSON ROBERTO SANTOS',
  'ANTONIO ARÊAS SOBRINHO': 'ANTONIO ARÃAS SOBRINHO',
};
function normDocente(raw) {
  let s = (raw || '').toUpperCase().trim();
  s = s.replace(/\bJR\./g, 'JÚNIOR');
  s = s.replace(/\bAUGUSTUS\b/g, 'AUGUSTO').replace(/\bAUGUSTOS\b/g, 'AUGUSTO');
  s = s.replace(/\.+$/g, '').replace(/\s+/g, ' ').trim();
  if (ALIAS[s]) s = ALIAS[s];
  return s;
}
function normTit(raw) {
  let s = (raw || '').toUpperCase().trim();
  if (!s || /^[-]+$/.test(s)) return '';
  s = s.replace(/\bMESTRE\b/g, 'MESTRADO').replace(/\bGRADUADA\b/g, 'GRADUADO');
  return s;
}
function normCh(raw) {
  const s = (raw || '').trim();
  if (/^\d+$/.test(s)) return s + 'H';
  return '';
}
function normStatus(raw, disc) {
  const s = (raw || '').toUpperCase().trim();
  if (/APROVAD/.test(s)) return 'AP';
  if (/CUMPRID|CUMPRIU/.test(s)) return 'CUMPRIDA';
  if (!s) return disc.toUpperCase().includes('COMPLEMENTAR') ? 'CUMPRIDA' : 'AP';
  return s;
}

// ---------- parse XML ----------
function cellTexts(rowXml) {
  const cells = [];
  const starts = [];
  const re = /<w:tc[ >]/g;
  let m;
  while ((m = re.exec(rowXml)) !== null) starts.push(m.index);
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : rowXml.length;
    const seg = rowXml.slice(start, end);
    const texts = [...seg.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((x) => x[1]);
    cells.push(texts.join('').trim());
  }
  return cells;
}
function parseRows(xml) {
  const rows = xml.split('<w:tr ').slice(1);
  const out = [];
  for (const row of rows) {
    const end = row.indexOf('</w:tr>');
    const rowXml = end >= 0 ? row.slice(0, end) : row;
    const cells = cellTexts(rowXml);
    if (cells.length >= 5 && cells.some((c) => /\d{4}\.\d/.test(c))) {
      // [periodo, disciplina, docente, titulacao, ch, ft, nota, status]
      out.push({
        periodo: collapseWs(cells[0]),
        disciplina: collapseWs(cells[1]),
        docenteRaw: cells[2],
        titulacao: normTit(cells[3]),
        ch: normCh(cells[4]),
        status: normStatus(cells[7], cells[1]),
      });
    }
  }
  return out;
}

// ---------- read existing DB ----------
const db = fs.readFileSync(DB_PATH, 'utf8');
const docBlock = db.slice(db.indexOf('const DOCENTES_SEED'), db.indexOf('function seedDocentes'));
const existingDocentes = new Map(); // key -> canonical name
for (const m of docBlock.matchAll(/\{ nome: '([^']*)', titulacao: '([^']*)' \}/g)) {
  existingDocentes.set(stripAcc(m[1]), m[1]);
}
const discBlock = db.slice(db.indexOf('const DISCIPLINAS_SEED'), db.indexOf('function seedDisciplinas'));
const existingDiscKeys = new Set();
for (const m of discBlock.matchAll(/\{ nome: '([^']*)', docente: '([^']*)', ch: '([^']*)' \}/g)) {
  existingDiscKeys.add(stripAcc(m[1]));
}

// ---------- parse all docs ----------
const docs = DOC_FILES.map((c) => ({ ...c, rows: parseRows(fs.readFileSync(c.file, 'utf8')) }));

// ---------- resolve docentes (existing vs new) ----------
const newDocentes = new Map(); // key -> { nome, tit }
function resolveDocente(raw, tit) {
  if (!raw || /^[-]+$/.test(raw)) return '';
  const norm = normDocente(raw);
  if (!norm) return '';
  const key = stripAcc(norm);
  if (existingDocentes.has(key)) return existingDocentes.get(key);
  if (newDocentes.has(key)) {
    if (tit && !newDocentes.get(key).tit) newDocentes.get(key).tit = tit;
    return newDocentes.get(key).nome;
  }
  newDocentes.set(key, { nome: norm, tit: tit || '' });
  return norm;
}
// First pass: register all docentes with their titulacao (from the documents)
for (const d of docs) {
  for (const r of d.rows) resolveDocente(r.docenteRaw, r.titulacao);
}
for (const v of newDocentes.values()) if (!v.tit) v.tit = 'ESPECIALISTA';

// ---------- new disciplines (unique by name) ----------
const newDisciplines = new Map(); // key -> { nome, docente, ch }
for (const d of docs) {
  for (const r of d.rows) {
    if (!r.disciplina) continue;
    const key = stripAcc(r.disciplina);
    if (existingDiscKeys.has(key) || newDisciplines.has(key)) continue;
    newDisciplines.set(key, { nome: r.disciplina, docente: resolveDocente(r.docenteRaw), ch: r.ch });
  }
}

// ---------- build templates ----------
function tsRow(r) {
  const disc = r.disciplina.toUpperCase();
  const doc = resolveDocente(r.docenteRaw);
  // recompute titulacao per row from raw (document value, normalized)
  return `  { periodo: '${r.periodo}', disciplina: '${disc}', docente: '${doc}', titulacao: '${r.titulacao}', ch: '${r.ch}', status: '${r.status}' },`;
}
function buildTemplate(d) {
  const rows = d.rows.map(tsRow).join('\n');
  return `// Template do histórico padrão — FACIIP · ${d.label}
export const ${d.constName}: ReadonlyArray<{
  periodo: string;
  disciplina: string;
  docente: string;
  titulacao: string;
  ch: string;
  status: string;
}> = [
${rows}
];`;
}

// ---------- output ----------
function esc(s) { return s.replace(/'/g, "\\'"); }

const docLines = [...newDocentes.values()].map(
  (d) => `  { nome: '${esc(d.nome)}', titulacao: '${esc(d.tit)}' },`
);
const discLines = [...newDisciplines.values()].map(
  (d) => `  { nome: '${esc(d.nome)}', docente: '${esc(d.docente)}', ch: '${esc(d.ch)}' },`
);
const templateBlocks = docs.map(buildTemplate).join('\n\n');

const docentesOut = '  // Docentes da FACIIP (demais cursos)\n' + docLines.join('\n') + '\n';
const disciplinasOut = '  // Disciplinas da FACIIP (demais cursos)\n' + discLines.join('\n') + '\n';

const TMP = 'C:/Users/vinag/AppData/Local/Temp/opencode/';
fs.writeFileSync(TMP + 'out-docentes.txt', docentesOut, 'utf8');
fs.writeFileSync(TMP + 'out-disciplinas.txt', disciplinasOut, 'utf8');
fs.writeFileSync(TMP + 'out-templates.txt', templateBlocks + '\n', 'utf8');

console.log('===== SUMMARY =====');
console.log('New docentes:', newDocentes.size);
console.log('New disciplines:', newDisciplines.size);
for (const d of docs) console.log('  ' + d.label + ': ' + d.rows.length + ' rows');
