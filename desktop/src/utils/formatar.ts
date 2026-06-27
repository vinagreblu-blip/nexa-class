// Normaliza texto para formato título (ex: TEORIA GERAL -> Teoria Geral)
// Palavras pequenas (e, de, da, do, das, dos...) ficam em minúsculo, exceto no início
const PALAVRAS_PEQUENAS = new Set([
  'e', 'de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os',
  'em', 'no', 'na', 'nos', 'nas', 'num', 'numa', 'para', 'com',
  'sem', 'por', 'ao', 'à', 'às', 'que', 'ou',
]);

export function formatarDisciplina(texto: string): string {
  if (!texto) return '';
  const jaFormatado = texto !== texto.toUpperCase() && /[a-z]/.test(texto);
  if (jaFormatado) return texto;

  const palavras = texto.toLowerCase().split(/\s+/);
  const resultado = palavras.map((palavra, i) => {
    const limpa = palavra.replace(/[^\wÀ-ÿ-]/g, '');
    if (i > 0 && PALAVRAS_PEQUENAS.has(limpa)) return palavra;
    if (palavra.length === 0) return palavra;
    return palavra.charAt(0).toUpperCase() + palavra.slice(1);
  });
  return resultado.join(' ');
}
