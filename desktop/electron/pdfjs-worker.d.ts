// O pdfjs-dist 5.x tipa o build principal (legacy/build/pdf.d.mts) mas
// NÃO shipa declaração para o worker (legacy/build/pdf.worker.mjs).
// Declaração mínima (shorthand) para o import dinâmico do pdfjs-loader —
// o módulo é registrado como globalThis.pdfjsWorker e consumido pelo
// próprio pdfjs em runtime.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs';
