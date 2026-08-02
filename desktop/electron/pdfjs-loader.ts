// Helper para carregar pdfjs-dist v4+ (ESM-only) de dentro de CJS.
// Antes: require('pdfjs-dist/legacy/build/pdf.js') (v3, CJS).
// Agora: dynamic import + setup do worker.
//
// Segurança: v3.11.174 tinha GHSA-wgrm-67xf-hhpq (RCE ao abrir PDF malicioso).
// v5+ corrige.

let pdfjsPromise: Promise<any> | null = null;

export async function getPdfjs(): Promise<any> {
  if (pdfjsPromise) return pdfjsPromise;

  pdfjsPromise = (async () => {
    // Dynamic import do build legacy (compat Node). Em v4+ só existe .mjs.
    const mod: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // Em ESM dinâmico dentro de CJS, a API pode estar em mod.default ou direto.
    const lib = mod?.default ?? mod;
    // Worker: em Node não há DOM worker; usar o worker em modo "fake" (mesma thread).
    // Isto é necessário em v4+. Aviso: bloqueia o event loop enquanto parseia PDF.
    try {
      lib.GlobalWorkerOptions.workerSrc = '';
    } catch { /* algums versões não exigem */ }
    return lib;
  })();

  return pdfjsPromise;
}
