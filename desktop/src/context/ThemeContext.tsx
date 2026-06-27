import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Tema = 'light' | 'dark';

interface ThemeContextValue {
  tema: Tema;
  alternar: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = 'nexa-theme';
const STORAGE_KEY_ANTIGO = 'erich-fromm-theme';

function lerTemaSalvo(): Tema {
  let salvo = localStorage.getItem(STORAGE_KEY);
  if (!salvo) {
    // migra da chave antiga
    salvo = localStorage.getItem(STORAGE_KEY_ANTIGO);
    if (salvo) localStorage.setItem(STORAGE_KEY, salvo);
  }
  if (salvo === 'light' || salvo === 'dark') return salvo;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function aplicarTemaInicial(): void {
  const tema = lerTemaSalvo();
  document.documentElement.setAttribute('data-theme', tema);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>(() => lerTemaSalvo());

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', tema);
    localStorage.setItem(STORAGE_KEY, tema);
  }, [tema]);

  const alternar = () => setTema((t) => (t === 'dark' ? 'light' : 'dark'));

  return <ThemeContext.Provider value={{ tema, alternar }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme precisa estar dentro de ThemeProvider');
  return ctx;
}
