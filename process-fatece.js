'use strict';
/* eslint-disable no-console */
// Parser para os documentos FATECE (docx XML extraídos).
// Extrai periodo, disciplina, docente, titulacao, ch, status da tabela principal (6 colunas)
// e identifica NOVOS docentes/disciplinas em relação ao database.ts atual.
const fs = require('fs');

const XMLS = {
  ADM: 'C:\\Users\\vinag\\AppData\\Local\\Temp\\opencode\\fateceadm\\ex\\word\\document.xml',
  PEDAGOGIA: 'C:\\Users\\vinag\\AppData\\Local\\Temp\\opencode\\fateceped\\ex\\word\\document.xml',
  TEOLOGIA: 'C:\\Users\\vinag\\AppData\\Local\\Temp\\opencode\\fateceteo\\ex\\word\\document.xml',
};
const DB_TS = 'C:\\dev\\pessoal\\universidade-app\\desktop\\electron\\database.ts';

// ---------- helpers de parsing XML (stack manual para lidar com tabelas aninhadas) ----------
// localiza abertura de tag precisa: <w:tbl , <w:tbl> (NÃO <w:tblPr / <w:tblGrid)
function indexOfTagOpen(xml, tag, fromIdx) {
  const tag2 = '<' + tag;
  let i = fromIdx;
  for (;;) {
    const s = xml.indexOf(tag2, i);
    if (s === -1) return -1;
    const after = xml.charAt(s + tag2.length);
    if (after === '>' || after === ' ' || after === '\t' || after === '\n' || after === '\r') return s;
    i = s + tag2.length;
  }
}

function findMatchingClose(xml, openIdx, tag) {
  const openTag = '<' + tag;
  const closeTag = '</' + tag + '>';
  let depth = 1;
  let i = openIdx + openTag.length;
  while (depth > 0) {
    const nextOpen = indexOfTagOpen(xml, tag, i);
    const nextClose = xml.indexOf(closeTag, i);
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + openTag.length;
    } else {
      depth--;
      i = nextClose + closeTag.length;
    }
  }
  return i;
}

function topLevelTables(xml) {
  const out = [];
  let i = 0;
  for (;;) {
    const s = indexOfTagOpen(xml, 'w:tbl', i);
    if (s === -1) break;
    const e = findMatchingClose(xml, s, 'w:tbl');
    if (e === -1) break;
    out.push({ start: s, end: e, content: xml.slice(s, e) });
    i = e;
  }
  return out;
}

function allTables(xml, acc) {
  acc = acc || [];
  let i = 0;
  for (;;) {
    const s = indexOfTagOpen(xml, 'w:tbl', i);
    if (s === -1) break;
    const e = findMatchingClose(xml, s, 'w:tbl');
    if (e === -1) break;
    const content = xml.slice(s, e);
    acc.push(content);
    // corpo do elemento (após a tag de abertura)
    const body = content.slice(content.indexOf('>') + 1);
    allTables(body, acc);
    i = e;
  }
  return acc;
}

function directChildRows(tableContent) {
  const out = [];
  let i = tableContent.indexOf('>') + 1; // pula a tag <w:tbl ...>
  for (;;) {
    const s = indexOfTagOpen(tableContent, 'w:tr', i);
    if (s === -1) break;
    const e = findMatchingClose(tableContent, s, 'w:tr');
    if (e === -1) break;
    out.push(tableContent.slice(s, e));
    i = e;
  }
  return out;
}

function directChildCells(rowContent) {
  const out = [];
  let i = rowContent.indexOf('>') + 1; // pula a tag <w:tr ...>
  for (;;) {
    const s = indexOfTagOpen(rowContent, 'w:tc', i);
    if (s === -1) break;
    const e = findMatchingClose(rowContent, s, 'w:tc');
    if (e === -1) break;
    out.push(rowContent.slice(s, e));
    i = e;
  }
  return out;
}

function cellText(cellContent) {
  // remove tabelas aninhadas antes de coletar <w:t>
  let c = cellContent.slice(cellContent.indexOf('>') + 1);
  for (;;) {
    const s = indexOfTagOpen(c, 'w:tbl');
    if (s === -1) break;
    const e = findMatchingClose(c, s, 'w:tbl');
    if (e === -1) break;
    c = c.slice(0, s) + c.slice(e);
  }
  const parts = [];
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:t(?:\s[^>]*)?\/>/g;
  let m;
  while ((m = re.exec(c))) parts.push(m[1] || '');
  return parts.join('').trim();
}

function gridColCount(tableContent) {
  const m = tableContent.match(/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/);
  if (!m) return 0;
  return (m[1].match(/<w:gridCol/g) || []).length;
}

// ---------- normalização ----------
function normTxt(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}
function stripAccents(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function normalizeTitulacao(raw) {
  if (!raw) return '';
  const t = raw.toUpperCase().trim();
  if (t.includes('GRADUAD')) return 'GRADUADO';
  if (t.includes('MESTR') || t === 'MESTRE' || t === 'MESTRA') return 'MESTRADO';
  if (t.includes('DOUTOR')) {
    if (t.includes('DOUTORA')) return 'DOUTORA';
    return 'DOUTOR';
  }
  if (t.includes('ESPECIAL')) return 'ESPECIALISTA';
  if (t === 'MESTRADO' || t === 'ESPECIALISTA' || t === 'DOUTOR' || t === 'DOUTORA' || t === 'GRADUADO') return t;
  return t;
}
function normalizeStatus(raw) {
  if (!raw) return '';
  const s = raw.toUpperCase().trim();
  if (s.includes('APROVAD')) return 'AP';
  if (s.includes('CUMPRI') || s.includes('CUMPRID')) return 'CUMPRIDA';
  if (s === 'AP' || s === 'REP' || s === 'CUMP' || s === 'MAT' || s === 'TRANC') return s;
  return s;
}
function normalizeCh(raw) {
  if (!raw) return '';
  const c = raw.replace(/\s+/g, '').toUpperCase();
  if (/H$/.test(c)) return c;
  const digits = c.replace(/\D/g, '');
  if (!digits) return c;
  return digits + 'H';
}

// ---------- extrai linhas de dado ----------
// Estrutura: cada período é um cabeçalho (1 célula "2020.2"); as linhas seguintes
// com 6 células são disciplinas: [disciplina, docente, titulacao, ch, nota, status].
const PERIODO_RE = /^\d{4}\.\d$/;
function extractRows(xml) {
  const tables = allTables(xml);
  const data = [];
  let currentPeriodo = null;
  for (const t of tables) {
    for (const r of directChildRows(t)) {
      const cells = directChildCells(r).map(cellText).filter((c) => c !== '');
      if (cells.length === 0) continue;
      // cabeçalho de período: única célula no formato 2020.2
      if (cells.length === 1 && PERIODO_RE.test(cells[0])) {
        currentPeriodo = cells[0];
        continue;
      }
      // linha de "TOTAIS DO PERÍODO"
      if (/TOTAIS/i.test(cells[0])) continue;
      // linha de disciplina: >= 6 células [disc, docente, tit, ch, nota, status]
      if (cells.length >= 6 && currentPeriodo) {
        const ch = normalizeCh(cells[cells.length - 3]);
        const status = normalizeStatus(cells[cells.length - 1]);
        if (!/\d/.test(ch)) continue; // descarta cabeçalhos/lixo
        data.push({
          periodo: currentPeriodo,
          disciplina: normTxt(cells[0]),
          docente: normTxt(cells[1]).toUpperCase(),
          titulacao: normalizeTitulacao(cells[2]),
          ch,
          status,
        });
      }
    }
  }
  return data;
}

// ---------- lê database.ts para obter existentes ----------
function readExistingFromDb() {
  const src = fs.readFileSync(DB_TS, 'utf8');
  function block(name) {
    const re = new RegExp('const ' + name + '[^=]*=\\s*\\[([\\s\\S]*?)\\n\\];');
    const m = src.match(re);
    return m ? m[1] : '';
  }
  const docentes = new Map(); // key accentless -> {nome, titulacao}
  const dBlock = block('DOCENTES_SEED');
  let dm;
  const dRe = /\{\s*nome:\s*'([^']*)'\s*,\s*titulacao:\s*'([^']*)'\s*\}/g;
  while ((dm = dRe.exec(dBlock))) {
    docentes.set(stripAccents(dm[1]).toUpperCase(), { nome: dm[1], titulacao: dm[2] });
  }
  const disciplinas = new Map(); // key accentless -> nome
  const discBlock = block('DISCIPLINAS_SEED');
  let dism;
  const disRe = /\{\s*nome:\s*'((?:[^'\\]|\\.)*)'\s*,\s*docente:\s*'([^']*)'\s*,\s*ch:\s*'([^']*)'\s*\}/g;
  while ((dism = disRe.exec(discBlock))) {
    disciplinas.set(stripAccents(dism[1]).toUpperCase(), dism[1]);
  }
  return { docentes, disciplinas };
}

// ---------- main ----------
function main() {
  const { docentes: existDoc, disciplinas: existDisc } = readExistingFromDb();
  console.log('EXISTENTES: docentes=' + existDoc.size + ' disciplinas=' + existDisc.size);

  const all = { ADM: [], PEDAGOGIA: [], TEOLOGIA: [] };
  for (const [k, path] of Object.entries(XMLS)) {
    const xml = fs.readFileSync(path, 'utf8');
    all[k] = extractRows(xml);
    console.log('\n=== ' + k + ' ===');
    console.log('linhas extraidas: ' + all[k].length);
    const periodos = [...new Set(all[k].map((r) => r.periodo))];
    console.log('periodos: ' + periodos.join(', '));
    // checa duplicatas (periodo + disciplina)
    const seen = new Map();
    let dup = 0;
    for (const r of all[k]) {
      const key = r.periodo + '|' + r.disciplina.toLowerCase();
      seen.set(key, (seen.get(key) || 0) + 1);
      if (seen.get(key) > 1) dup++;
    }
    console.log('duplicatas(periodo+disc): ' + dup);
    const perP = {};
    for (const r of all[k]) perP[r.periodo] = (perP[r.periodo] || 0) + 1;
    console.log('por periodo: ' + JSON.stringify(perP));
    console.log('primeiras 3 linhas:');
    all[k].slice(0, 3).forEach((r) => console.log(JSON.stringify(r)));
    console.log('ultimas 2 linhas:');
    all[k].slice(-2).forEach((r) => console.log(JSON.stringify(r)));
    // titulacoes distintas
    const tits = [...new Set(all[k].map((r) => r.titulacao))];
    console.log('titulacoes: ' + tits.join(' | '));
    const stats = [...new Set(all[k].map((r) => r.status))];
    console.log('status: ' + stats.join(' | '));
    const chs = [...new Set(all[k].map((r) => r.ch))];
    console.log('ch distintas: ' + chs.join(', '));
  }

  // identifica novos docentes (dedup accentless).
  // ADM reutiliza o template HISTORICO_PADRAO_HELIOROCHA_ADM (já seedado), então
  // novos itens são detectados apenas em PEDAGOGIA e TEOLOGIA.
  const newDocentes = new Map(); // key -> {nome, titulacao}
  for (const k of ['PEDAGOGIA', 'TEOLOGIA']) {
    for (const r of all[k]) {
      if (!r.docente) continue;
      const key = stripAccents(r.docente).toUpperCase();
      if (existDoc.has(key)) continue;
      const cur = newDocentes.get(key);
      if (!cur) newDocentes.set(key, { nome: r.docente, titulacao: r.titulacao || 'ESPECIALISTA' });
      else if (!cur.titulacao && r.titulacao) newDocentes.set(key, { nome: r.docente, titulacao: r.titulacao });
    }
  }
  console.log('\nNOVOS DOCENTES: ' + newDocentes.size);
  [...newDocentes.values()].forEach((d) => console.log('  ' + d.nome + ' :: ' + d.titulacao));

  // identifica novas disciplinas (dedup accentless por nome) — PED+TEO
  const newDisciplinas = new Map(); // key -> {nome, docente, ch}
  for (const k of ['PEDAGOGIA', 'TEOLOGIA']) {
    for (const r of all[k]) {
      if (!r.disciplina) continue;
      const key = stripAccents(r.disciplina).toUpperCase();
      if (existDisc.has(key) || newDisciplinas.has(key)) continue;
      newDisciplinas.set(key, { nome: r.disciplina, docente: r.docente, ch: r.ch });
    }
  }
  console.log('\nNOVAS DISCIPLINAS: ' + newDisciplinas.size);
  [...newDisciplinas.values()].forEach((d) => console.log('  ' + d.nome + ' :: ' + d.docente + ' :: ' + d.ch));

  generateCode(all, newDocentes, newDisciplinas);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function generateCode(all, newDocentes, newDisciplinas) {
  const outDir = 'C:\\Users\\vinag\\AppData\\Local\\Temp\\opencode';

  // 1) docentes
  let docentesCode = '  // Docentes da FATECE (Pedagogia e Teologia)\n';
  for (const d of newDocentes.values()) {
    docentesCode += `  { nome: '${esc(d.nome)}', titulacao: '${esc(d.titulacao)}' },\n`;
  }
  fs.writeFileSync(outDir + '\\fatece-docentes.txt', docentesCode, 'utf8');

  // 2) disciplinas
  let discCode = '  // Disciplinas da FATECE (Pedagogia e Teologia)\n';
  for (const d of newDisciplinas.values()) {
    discCode += `  { nome: '${esc(d.nome)}', docente: '${esc(d.docente)}', ch: '${esc(d.ch)}' },\n`;
  }
  fs.writeFileSync(outDir + '\\fatece-disciplinas.txt', discCode, 'utf8');

  // 3) templates
  const tpl = (name, cursoLabel, rows) => {
    let s = `// Template do histórico padrão — FATECE · ${cursoLabel}\n`;
    s += `// Extraído do documento FATECE ${cursoLabel}.\n`;
    s += `export const ${name}: ReadonlyArray<{\n`;
    s += `  periodo: string;\n  disciplina: string;\n  docente: string;\n`;
    s += `  titulacao: string;\n  ch: string;\n  status: string;\n}> = [\n`;
    let last = null;
    for (const r of rows) {
      if (r.periodo !== last) {
        s += `  // ${r.periodo}\n`;
        last = r.periodo;
      }
      s += `  { periodo: '${esc(r.periodo)}', disciplina: '${esc(r.disciplina)}', docente: '${esc(r.docente)}', titulacao: '${esc(r.titulacao)}', ch: '${esc(r.ch)}', status: '${esc(r.status)}' },\n`;
    }
    s += '];\n';
    return s;
  };

  const pedTpl = tpl('HISTORICO_PADRAO_FATECE_PEDAGOGIA', 'Pedagogia', all.PEDAGOGIA);
  const teoTpl = tpl('HISTORICO_PADRAO_FATECE_TEOLOGIA', 'Teologia', all.TEOLOGIA);
  fs.writeFileSync(outDir + '\\fatece-template-ped.txt', pedTpl, 'utf8');
  fs.writeFileSync(outDir + '\\fatece-template-teo.txt', teoTpl, 'utf8');

  console.log('\nCodigo gerado em ' + outDir + ' (fatece-*.txt)');
}

main();
