// ============================================================
// MATCHING ALUNO↔CURSO POR NOME (compartilhado)
// ============================================================
// O vínculo aluno↔curso é por comparação de NOME (alunos.curso ↔
// cursos.nome). Historicamente havia 3 implementações divergentes:
// pendencias.ts (JS normalizado), coletor.ts (SQL com 24 REPLACE —
// QUEBRADO: parênteses errados davam "syntax error near LIMIT" no
// SQLite real e derrubavam a geração do XML) e ipc/diplomas-digitais
// (só LOWER(), perdia acentos). Unificadas aqui.
//
// Normalização: remove diacríticos (NFD), minúsculas, trim —
// "ADMINISTRACAO" casa com "ADMINISTRAÇÃO". Plural e pontuação NÃO
// são tolerados (nomes oficiais têm que bater).
//

export function normalizarNomeCurso(t: unknown): string {
  return String(t ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Primeiro curso da lista (ordem de envio — usar ORDER BY id) cujo nome
 * normalizado é idêntico ao buscado. `nome` vazio → undefined.
 */
export function encontrarCursoPorNome<T extends { nome: string | null }>(
  cursos: readonly T[],
  nome: unknown
): T | undefined {
  const alvo = normalizarNomeCurso(nome);
  if (!alvo) return undefined;
  return cursos.find((c) => normalizarNomeCurso(c.nome) === alvo);
}
