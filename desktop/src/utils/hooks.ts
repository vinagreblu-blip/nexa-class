import { useEffect, useState } from 'react';

/**
 * Hook de debounce.
 * Antes, cada página (Alunos, Docentes, Disciplinas, CursosLivres, Declaracoes, Diploma)
 * reimplementava o mesmo padrão `useEffect(() => { const t = setTimeout(...); return () => clearTimeout(t); }, [busca])`.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
