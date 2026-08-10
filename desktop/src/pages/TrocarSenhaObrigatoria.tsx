import type { FormEvent } from 'react';
import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

// Exibida quando o usuário logado tem senha_temporaria = 1 (admin recém-criado,
// reset de senha ou instalação antiga ainda com a senha padrão). Bloqueia o uso
// até que a senha seja trocada.
export function TrocarSenhaObrigatoria() {
  const { usuario, atualizarSessao, logout } = useAuth();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (nova.length < 6) {
      setErro('A nova senha deve ter ao menos 6 caracteres.');
      return;
    }
    if (nova !== confirmar) {
      setErro('A confirmação não confere com a nova senha.');
      return;
    }
    if (nova === atual) {
      setErro('A nova senha deve ser diferente da atual.');
      return;
    }
    setSalvando(true);
    try {
      const res = await api.auth.alterarSenha(atual, nova);
      if (!res.ok) {
        setErro(res.error ?? 'Não foi possível trocar a senha.');
      } else {
        await atualizarSessao();
      }
    } catch {
      setErro('Erro de comunicação. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1f4e5f 0%, #143a47 100%)',
      }}
    >
      <div className="card" style={{ width: 420, padding: 32 }}>
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ margin: '0 0 6px', fontSize: 22 }}>Troca de senha obrigatória</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
            Olá, <strong>{usuario?.nome}</strong>. Por segurança, defina uma nova senha antes de continuar.
          </p>
        </div>

        {erro && <div className="alert alert-error">{erro}</div>}

        <form onSubmit={submit}>
          <div className="form-row">
            <label>Senha atual</label>
            <input
              type="password"
              value={atual}
              onChange={(e) => setAtual(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
          </div>
          <div className="form-row">
            <label>Nova senha</label>
            <input
              type="password"
              value={nova}
              onChange={(e) => setNova(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="form-row">
            <label>Confirmar nova senha</label>
            <input
              type="password"
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <button
            type="submit"
            className="btn-primary"
            disabled={salvando || !atual || !nova || !confirmar}
            style={{ width: '100%', marginTop: 6 }}
          >
            {salvando ? 'Salvando…' : 'Trocar senha e continuar'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => logout()}
          className="btn-ghost"
          style={{ width: '100%', marginTop: 10 }}
        >
          Sair
        </button>
      </div>
    </div>
  );
}
