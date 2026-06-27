import { FormEvent, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import nexaLogo from '../assets/nexa-logo.png';

export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    const res = await login(username.trim(), password);
    if (!res.ok) {
      setErro(res.error ?? 'Falha ao entrar');
      setEnviando(false);
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
      <div className="card" style={{ width: 380, padding: 32 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img
            src={nexaLogo}
            alt="NEXA CLASS"
            style={{ width: 120, height: 'auto', marginBottom: 12, objectFit: 'contain' }}
          />
          <h1 style={{ margin: '0 0 4px', fontSize: 24, letterSpacing: 2 }}>NEXA CLASS</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 11 }}>
            Network for Education and Academic Excellence Class
          </p>
        </div>

        {erro && <div className="alert alert-error">{erro}</div>}

        <form onSubmit={submit}>
          <div className="form-row">
            <label>Usuário</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
            />
          </div>
          <div className="form-row">
            <label>Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <button
            type="submit"
            className="btn-primary"
            disabled={enviando || !username || !password}
            style={{ width: '100%', marginTop: 6 }}
          >
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 18, marginBottom: 0 }}>
          Esqueceu a senha? Contate o administrador do sistema.
        </p>
      </div>
    </div>
  );
}
