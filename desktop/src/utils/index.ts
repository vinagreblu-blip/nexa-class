/**
 * Helpers compartilhados do frontend.
 * Centraliza funções que antes estavam duplicadas entre páginas.
 */

/** Máscara de CPF: 000.000.000-00. Antes duplicada em Alunos.tsx e NovoAlunoModal.tsx. */
export function mascararCPF(valor: string): string {
  const d = valor.replace(/\D/g, '').substring(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.substring(0, 3)}.${d.substring(3)}`;
  if (d.length <= 9) return `${d.substring(0, 3)}.${d.substring(3, 6)}.${d.substring(6)}`;
  return `${d.substring(0, 3)}.${d.substring(3, 6)}.${d.substring(6, 9)}-${d.substring(9)}`;
}

/** Máscara de telefone brasileiro: (00) 0000-0000 ou (00) 00000-0000. */
export function mascararTelefone(valor: string): string {
  const d = valor.replace(/\D/g, '').substring(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.substring(0, 2)}) ${d.substring(2)}`;
  if (d.length <= 10) return `(${d.substring(0, 2)}) ${d.substring(2, 6)}-${d.substring(6)}`;
  return `(${d.substring(0, 2)}) ${d.substring(2, 7)}-${d.substring(7)}`;
}

/** Formata data ISO (YYYY-MM-DD) para DD/MM/YYYY. */
export function formatarData(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('T')[0].split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
