// ============================================================
// TESTE — pdfjs-loader (fake worker no Electron-main/Node)
// ============================================================
// Regressão real: o loader antigo atribuía
// GlobalWorkerOptions.workerSrc = '' e o pdfjs 5.7 lançava
// 'No "GlobalWorkerOptions.workerSrc" specified.' /
// 'Setting up fake worker failed: "..."' em TODA conversão
// (documento:converter-xml), extração e conversões.
// Este teste reproduz o uso de produção (getDocument + texto) no
// MESMO ambiente do main process (Node, sem DOM worker).
import { describe, it, expect } from 'vitest';
import { getPdfjs } from './pdfjs-loader';

/** Monta um PDF 1.4 mínimo e VÁLIDO (xref com offsets corretos) com uma
 *  página e um texto em Helvetica base14 — suficiente para o pdfjs
 *  extrair conteúdo de texto sem fontes embutidas. */
function pdfMinimo(texto: string): Uint8Array {
  const stream = `BT /F1 12 Tf 10 50 Td (${texto}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  // ASCII puro: length em bytes == length em caracteres.
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

describe('pdfjs-loader — fake worker configurável sem workerSrc', () => {
  it('carrega o pdfjs e extrai texto de um PDF (regressão: "Setting up fake worker failed")', async () => {
    const pdfjs = await getPdfjs();
    expect(pdfjs?.getDocument).toBeTruthy();

    const task = pdfjs.getDocument({
      data: pdfMinimo('TESTEPDF123'),
      disableFontFace: true,
      useSystemFonts: false,
    });
    // O erro da regressão estourava exatamente aqui (promise do worker).
    const pdf = await task.promise;
    expect(pdf.numPages).toBe(1);

    const page = await pdf.getPage(1);
    const conteudo = await page.getTextContent();
    const texto = (conteudo.items ?? []).map((i: any) => i.str ?? '').join(' ');
    expect(texto).toContain('TESTEPDF123');

    await pdf.destroy();
  }, 60000);
});
