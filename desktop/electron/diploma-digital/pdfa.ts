// ============================================================
// PDF/A-1b — pós-processamento, autochecagem e veraPDF opcional
// ============================================================
// O pdfkit gera o conteúdo visual; a CONFORMIDADE PDF/A-1b (ISO
// 19005-1, nível b) exige três coisas que ele não faz sozinho:
//   1. FONTES EMBUTIDAS (fontes base-14 não valem) — resolvido no
//      gerador com Noto Sans TTF (assets/fonts, OFL);
//   2. OUTPUTINTENT com perfil ICC — injetado aqui com o sRGB
//      (assets/icc/sRGB-v2-magic.icc) no catálogo do documento;
//   3. XMP com pdfaid:part=1 + conformance=B — gravado aqui, sincronizado
//      com o /Info do pdfkit (título/autor/producer).
// Além disso: PDF 1.4 (header reescrito — pdf-lib grava sempre 1.7) e
// serialização SEM object streams/xref streams (proibidos no 1.4).
//
// NÃO SIMULAR: a autochecagem verifica estrutura (header, OutputIntent,
// XMP, fontes embutidas, sem criptografia) e o veraPDF (CLI oficial do
// consórcio, se configurado em `configuracoes` chave 'verapdf' ou env
// NEXA_VERAPDF) faz a validação completa. Sem veraPDF → pendência
// explícita, nunca "conforme".
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PDFDocument, PDFName, PDFString, PDFDict, PDFArray, PDFRawStream } from 'pdf-lib';

/** Resolve um asset embarcado (extraResources em produção; repo em dev). */
export function caminhoAsset(rel: string): string {
  const candidatos = [
    path.join(process.resourcesPath ?? '', 'assets', rel),
    path.resolve(__dirname, '..', '..', '..', 'assets', rel),
    path.resolve(process.cwd(), 'assets', rel),
  ];
  for (const c of candidatos) {
    try {
      if (fs.existsSync(c)) return c;
    } catch { /* ignora */ }
  }
  return candidatos[1];
}

function agoraIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function xmpPdfA(titulo: string, criador: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const quando = agoraIso();
  return (
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n' +
    '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
    '    <rdf:Description rdf:about=""\n' +
    '        xmlns:dc="http://purl.org/dc/elements/1.1/"\n' +
    '        xmlns:xmp="http://ns.adobe.com/xap/1.0/"\n' +
    '        xmlns:pdf="http://ns.adobe.com/pdf/1.3/"\n' +
    '        xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">\n' +
    '      <dc:format>application/pdf</dc:format>\n' +
    `      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(titulo)}</rdf:li></rdf:Alt></dc:title>\n` +
    `      <xmp:CreateDate>${quando}</xmp:CreateDate>\n` +
    `      <xmp:ModifyDate>${quando}</xmp:ModifyDate>\n` +
    `      <xmp:CreatorTool>${esc(criador)}</xmp:CreatorTool>\n` +
    '      <pdf:Producer>NEXA CLASS (pdfkit + pdf-lib)</pdf:Producer>\n' +
    '      <pdfaid:part>1</pdfaid:part>\n' +
    '      <pdfaid:conformance>B</pdfaid:conformance>\n' +
    '    </rdf:Description>\n' +
    '  </rdf:RDF>\n' +
    '</x:xmpmeta>\n' +
    '<?xpacket end="w"?>'
  );
}

export interface OpcoesPdfA {
  titulo: string;
  criador?: string;
}

/** Pós-processa o PDF do pdfkit para a forma PDF/A-1b estrutural
 *  (OutputIntent sRGB + XMP pdfaid + header 1.4 + sem object streams). */
export async function converterParaPdfA1b(pdfBytes: Buffer, opts: OpcoesPdfA): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false, ignoreEncryption: true });
  const ctx = doc.context;

  // 1) XMP (Metadata) — substitui qualquer XMP pré-existente
  const xmp = xmpPdfA(opts.titulo, opts.criador ?? 'NEXA CLASS — Diploma Digital MEC');
  const xmpStream = ctx.stream(xmp, { Type: 'Metadata', Subtype: 'XML' });
  const xmpRef = ctx.register(xmpStream);
  doc.catalog.set(PDFName.of('Metadata'), xmpRef);

  // 2) OutputIntent com o perfil ICC sRGB
  const icc = fs.readFileSync(caminhoAsset(path.join('icc', 'sRGB-v2-magic.icc')));
  const iccStream = ctx.flateStream(icc, { N: 3 });
  const iccRef = ctx.register(iccStream);
  const outputIntent = ctx.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    // Campos STRING (parênteses), não names — pdf-lib converte string
    // para PDFName; PDFString.of é explícito.
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
    Info: PDFString.of('sRGB IEC61966-2.1 (Compact-ICC sRGB-v2-magic)'),
    RegistryName: PDFString.of('http://www.color.org/'),
    DestOutputProfile: iccRef,
  });
  doc.catalog.set(PDFName.of('OutputIntents'), ctx.obj([outputIntent]));

  // 3) Serializa SEM object streams (PDF 1.4 não conhece) e corrige o
  //    header (pdf-lib grava sempre %PDF-1.7)
  const salvo = await doc.save({ useObjectStreams: false });
  const buf = Buffer.from(salvo);
  const idx = buf.indexOf('%PDF-1.');
  if (idx >= 0) buf.write('1.4', idx + 5, 'utf8');
  return buf;
}

// ------------------------------------------------------------
// AUTOCHECAGEM estrutural (offline; não substitui o veraPDF)
// ------------------------------------------------------------
export interface ChecagemPdfA {
  nome: string;
  ok: boolean;
  detalhe: string;
}

export interface ResultadoPdfA {
  conforme: boolean;
  checagens: ChecagemPdfA[];
}

/** Fontes do resource dict têm arquivo embutido (FontFile2/FontFile3)? */
function fontesEmbutidas(fontDict: PDFDict, vistos: Set<PDFDict>): { ok: boolean; detalhe: string } {
  const problemas: string[] = [];
  const chaves = fontDict.entries();
  for (const [chave, valor] of chaves) {
    if (!(valor instanceof PDFDict)) continue;
    const fd = valor;
    if (vistos.has(fd)) continue;
    vistos.add(fd);
    const nomeFonte = chave.toString();
    const subtype = fd.get(PDFName.of('Subtype'))?.toString() ?? '';
    const descBase = fd.get(PDFName.of('FontDescriptor'));
    let desc: PDFDict | undefined = descBase instanceof PDFDict ? descBase : undefined;
    if (subtype.includes('Type0')) {
      const descendentes = fd.get(PDFName.of('DescendantFonts'));
      if (descendentes instanceof PDFArray && descendentes.size() > 0) {
        const d0 = descendentes.get(0);
        if (d0 instanceof PDFDict) {
          const d = d0.get(PDFName.of('FontDescriptor'));
          if (d instanceof PDFDict) desc = d;
        }
      }
    }
    if (subtype.includes('Type3')) continue; // Type3 embute via CharProcs
    const embutido = desc
      ? !!(desc.get(PDFName.of('FontFile')) || desc.get(PDFName.of('FontFile2')) || desc.get(PDFName.of('FontFile3')))
      : false;
    if (!embutido) problemas.push(`${nomeFonte} (${subtype.replace(/\//g, '') || 'desconhecido'}) sem fonte embutida`);
  }
  return { ok: problemas.length === 0, detalhe: problemas.join('; ') || 'todas as fontes com FontFile2/3' };
}

/** Verifica a estrutura PDF/A-1b produzida por converterParaPdfA1b. */
export async function verificarPdfA1b(pdfBytes: Buffer): Promise<ResultadoPdfA> {
  const checagens: ChecagemPdfA[] = [];
  const texto = pdfBytes.toString('latin1');
  const mHeader = /^%PDF-(\d)\.(\d)/.exec(texto);
  checagens.push({
    nome: 'Versão do arquivo',
    ok: !!mHeader && Number(`${mHeader[1]}.${mHeader[2]}`) <= 1.4,
    detalhe: mHeader ? `%PDF-${mHeader[1]}.${mHeader[2]} (PDF/A-1 admite até 1.4)` : 'header ilegível',
  });
  checagens.push({
    nome: 'Sem criptografia',
    ok: !textosEncrypt(pdfBytes),
    detalhe: textosEncrypt(pdfBytes) ? 'documento criptografado é proibido' : 'sem /Encrypt',
  });
  try {
    const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false, ignoreEncryption: true });
    // OutputIntent GTS_PDFA1
    const ois = doc.catalog.get(PDFName.of('OutputIntents'));
    let oiOk = false;
    if (ois instanceof PDFArray && ois.size() > 0) {
      const o0 = ois.get(0);
      if (o0 instanceof PDFDict) {
        const s = o0.get(PDFName.of('S'))?.toString() ?? '';
        const dest = o0.get(PDFName.of('DestOutputProfile'));
        oiOk = s.includes('GTS_PDFA1') && !!dest;
      }
    }
    checagens.push({
      nome: 'OutputIntent (ICC)',
      ok: oiOk,
      detalhe: oiOk ? '/GTS_PDFA1 com DestOutputProfile sRGB' : 'OutputIntents ausente ou sem DestOutputProfile',
    });
    // XMP pdfaid
    const metaRef = doc.catalog.get(PDFName.of('Metadata'));
    let xmpOk = false;
    if (metaRef) {
      const resolvido = doc.context.lookup(metaRef);
      if (resolvido instanceof PDFRawStream) {
        const conteudo = Buffer.from(resolvido.contents).toString('utf8');
        xmpOk = /pdfaid:part\s*>\s*1</.test(conteudo) && /pdfaid:conformance\s*>\s*B</.test(conteudo);
        checagens.push({
          nome: 'Identificação XMP (pdfaid)',
          ok: xmpOk,
          detalhe: xmpOk ? 'pdfaid:part=1, conformance=B' : 'pdfaid ausente/incompleto no XMP',
        });
      }
    }
    if (!metaRef) {
      checagens.push({ nome: 'Identificação XMP (pdfaid)', ok: false, detalhe: 'sem /Metadata no catálogo' });
    }
    // Fontes embutidas (todas as páginas)
    const vistos = new Set<PDFDict>();
    const problemas: string[] = [];
    for (const pagina of doc.getPages()) {
      const res = pagina.node.Resources();
      if (!res) continue;
      const fonts = res.get(PDFName.of('Font'));
      if (fonts instanceof PDFDict) {
        const r = fontesEmbutidas(fonts, vistos);
        if (!r.ok) problemas.push(r.detalhe);
      }
    }
    checagens.push({
      nome: 'Fontes embutidas',
      ok: problemas.length === 0,
      detalhe: problemas.join('; ') || 'todas as fontes embutidas (TrueType)',
    });
  } catch (e: any) {
    checagens.push({ nome: 'Documento parseável', ok: false, detalhe: 'Falha ao parsear: ' + (e?.message ?? String(e)) });
  }
  return { conforme: checagens.every((c) => c.ok), checagens };
}

function textosEncrypt(pdfBytes: Buffer): boolean {
  const texto = pdfBytes.toString('latin1');
  return /\/Encrypt\s/.test(texto);
}

// ------------------------------------------------------------
// veraPDF (opcional) — validador oficial do PDF Association
// ------------------------------------------------------------
export interface ResultadoVeraPdf {
  executado: boolean;
  conforme: boolean | null;
  detalhe: string;
  falhas?: string[];
}

/** Caminho do veraPDF: config `verapdf` ({caminho}) > env NEXA_VERAPDF. */
export function caminhoVeraPdf(dbLike?: { preparar: (sql: string) => { get: (k: string) => unknown } }): string | null {
  try {
    const env = process.env.NEXA_VERAPDF;
    if (env && fs.existsSync(env)) return env;
    if (dbLike) {
      const row = dbLike.preparar('SELECT valor FROM configuracoes WHERE chave = ?').get('verapdf') as
        | { valor: string }
        | undefined;
      const cfg = row ? (JSON.parse(row.valor) as { caminho?: string }) : null;
      if (cfg?.caminho && fs.existsSync(cfg.caminho)) return cfg.caminho;
    }
  } catch { /* sem config → não executar */ }
  return null;
}

/** Executa `verapdf --flavour 1b --format json` no arquivo. */
export function rodarVeraPdf(exe: string, pdfPath: string, timeoutMs = 90000): Promise<ResultadoVeraPdf> {
  return new Promise((resolve) => {
    let saida = '';
    let erro = '';
    let proc: any;
    try {
      proc = spawn(exe, ['--flavour', '1b', '--format', 'json', pdfPath], { windowsHide: true });
    } catch (e: any) {
      resolve({ executado: false, conforme: null, detalhe: 'Não foi possível iniciar o veraPDF: ' + (e?.message ?? String(e)) });
      return;
    }
    const timer = setTimeout(() => {
      try { proc.kill(); } catch { /* noop */ }
      resolve({ executado: false, conforme: null, detalhe: `veraPDF excedeu ${timeoutMs / 1000}s (timeout).` });
    }, timeoutMs);
    proc.stdout?.on('data', (c: Buffer) => (saida += c.toString('utf8')));
    proc.stderr?.on('data', (c: Buffer) => (erro += c.toString('utf8')));
    proc.on('error', (e: Error) => {
      clearTimeout(timer);
      resolve({ executado: false, conforme: null, detalhe: 'Falha ao executar o veraPDF: ' + e.message });
    });
    proc.on('close', (code: number) => {
      clearTimeout(timer);
      if (code !== 0 && !saida) {
        resolve({ executado: false, conforme: null, detalhe: `veraPDF terminou com código ${code}${erro ? ': ' + erro.slice(0, 300) : ''}` });
        return;
      }
      try {
        const j = JSON.parse(saida);
        const rel = j?.report?.reports?.[0];
        const conforme = rel?.compliant === true;
        const falhas: string[] = [];
        if (rel?.details?.rules) {
          coletarFalhas(rel.details.rules, falhas);
        }
        resolve({ executado: true, conforme, detalhe: conforme ? 'veraPDF (flavour 1b): conforme' : 'veraPDF (flavour 1b): NÃO conforme', falhas: falhas.slice(0, 10) });
      } catch (e: any) {
        resolve({ executado: false, conforme: null, detalhe: 'Saída do veraPDF ilegível: ' + (e?.message ?? String(e)) });
      }
    });
  });
}

function coletarFalhas(no: any, out: string[], prof = 0): void {
  if (!no || prof > 12) return;
  if (Array.isArray(no)) {
    for (const n of no) coletarFalhas(n, out, prof + 1);
    return;
  }
  if (typeof no === 'object') {
    if (no.status === 'FAIL' && (no.rule || no.clause || no.test)) {
      out.push(`${no.rule ?? ''} (cláusula ${no.clause ?? '?'} — ${no.test ?? '?'})`.trim());
    }
    for (const v of Object.values(no)) coletarFalhas(v, out, prof + 1);
  }
}
