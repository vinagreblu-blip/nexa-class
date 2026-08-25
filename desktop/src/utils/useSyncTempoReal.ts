import { useEffect, useRef } from 'react';
import { api } from '../api';

/**
 * Recarrega os dados da tela quando OUTRA máquina altera registros no banco
 * central (via Supabase Realtime → main → evento IPC `dados:atualizados`).
 *
 * Uso (1 linha por página):
 *   useSyncTempoReal(carregar, ['alunos']);
 *
 * - `callback`: função de carregamento já existente na página (ex.: `carregar`),
 *   chamada com debounce de 300ms para agregar rajadas de eventos.
 * - `tabelas`: se informado, só recarrega quando uma dessas tabelas mudou.
 *   Omitir = recarrega em qualquer mudança sincronizada.
 *
 * Mutações do próprio usuário não passam por aqui — as páginas já recarregam
 * nas ações locais. Este hook cobre exclusivamente mudanças remotas.
 */
export function useSyncTempoReal(callback: () => void, tabelas?: string[]): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const tabelasRef = useRef(tabelas);
  tabelasRef.current = tabelas;

  useEffect(() => {
    let timer: number | undefined;
    const desinscrever = api.dados.onAtualizados((alteradas) => {
      const filtro = tabelasRef.current;
      if (filtro && filtro.length > 0 && !alteradas.some((t) => filtro.includes(t))) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        try {
          callbackRef.current();
        } catch {
          /* erro de carregamento já é tratado pela própria página */
        }
      }, 300);
    });
    return () => {
      desinscrever();
      window.clearTimeout(timer);
    };
  }, []);
}
