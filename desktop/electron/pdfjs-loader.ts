// Helper para carregar pdfjs-dist v4+ (ESM-only) de dentro de CJS.
// Antes: require('pdfjs-dist/legacy/build/pdf.js') (v3, CJS).
// Agora: dynamic import + setup do worker.
//
// Segurança: v3.11.174 tinha GHSA-wgrm-67xf-hhpq (RCE ao abrir PDF malicioso).
// v5+ corrige.
//
// WORKER: em Node/Electron-main não há DOM worker — o pdfjs usa o "fake
// worker" (mesma thread). Em v5.7 o fake worker faz
// import(GlobalWorkerOptions.workerSrc); atribuir '' (comportamento antigo
// deste loader) destruía o default "./pdf.worker.mjs" e o getter lançava
// 'No "GlobalWorkerOptions.workerSrc" specified.' → "Setting up fake
// worker failed" em TODA conversão/extração. Em vez de adivinhar
// caminho/URL (dev × app.asar), pré-carregamos o módulo do worker e o
// registramos como handler da thread principal (globalThis.pdfjsWorker) —
// mecanismo oficial do pdfjs, consultado ANTES do workerSrc — usando o
// mesmo import bare-specifier que já funciona para o pdf.mjs.

let pdfjsPromise: Promise<any> | null = null;

export async function getPdfjs(): Promise<any> {
  if (pdfjsPromise) return pdfjsPromise;

  pdfjsPromise = (async () => {
    // Dynamic import do build legacy (compat Node). Em v4+ só existe .mjs.
    const mod: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // Em ESM dinâmico dentro de CJS, a API pode estar em mod.default ou direto.
    const lib = mod?.default ?? mod;
    // Worker "fake" na MESMA thread (bloqueia o event loop enquanto
    // parseia — PDFs de documento são pequenos; comportamento histórico).
    const workerMod: any = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    (globalThis as any).pdfjsWorker = workerMod;
    return lib;
  })();

  return pdfjsPromise;
}
