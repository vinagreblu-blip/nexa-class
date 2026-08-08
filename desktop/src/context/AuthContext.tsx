import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api';
import type { Usuario } from '../types';

interface AuthContextValue {
  usuario: Usuario | null;
  carregando: boolean;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  atualizarSessao: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);

  const atualizarSessao = async () => {
    try {
      const res = await api.auth.sessao();
      setUsuario(res.ok ? res.data ?? null : null);
    } catch (e) {
      // IPC quebrado / preload ausente — não trava o app em "Carregando…" infinito.
      console.error('[auth] Falha ao carregar sessão:', e);
      setUsuario(null);
    }
  };

  useEffect(() => {
    (async () => {
      await atualizarSessao();
      setCarregando(false);
    })();
  }, []);

  const login = async (username: string, password: string) => {
    const res = await api.auth.login(username, password);
    if (res.ok && res.data) {
      setUsuario(res.data);
      return { ok: true };
    }
    return { ok: false, error: res.error };
  };

  const logout = async () => {
    try { await api.auth.logout(); } catch { /* ignora */ }
    setUsuario(null);
  };

  return (
    <AuthContext.Provider value={{ usuario, carregando, login, logout, atualizarSessao }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de AuthProvider');
  return ctx;
}
