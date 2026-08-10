import type { FormEvent } from 'react';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import nexaLogo from '../assets/nexa-logo.png';

type Modo = 'login' | 'solicitar' | 'redefinir';

export function Login() {
  const { login } = useAuth();
  const [modo, setModo] = useState<Modo>('login');

  // Campos compartilhados
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmaSenha, setConfirmaSenha] = useState('');

  const [erro, setErro] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const resetEstado = () => {
    setErro(null);
    setInfo(null);
  };

  const submitLogin = async (e: FormEvent) => {
    e.preventDefault();
    resetEstado();
    setEnviando(true);
    try {
      const res = await login(username.trim(), password);
      if (!res.ok) setErro(res.error ?? 'Falha ao entrar');
    } catch {
      setErro('Erro de comunicação. Tente novamente.');
    } finally {
      setEnviando(false);
    }
  };

  const submitSolicitar = async (e: FormEvent) => {
    e.preventDefault();
    resetEstado();
    setEnviando(true);
    try {
      const res = await api.auth.solicitarRecuperacao(email.trim());
      if (!res.ok) {
        setErro(res.error ?? 'Falha ao solicitar');
        return;
      }
      // Mensagem genérica — não revela se e-mail existe no sistema.
      setInfo(
        'Se o e-mail estiver cadastrado, você receberá um código de 6 dígitos em instantes. ' +
          'O código expira em 30 minutos.'
      );
      setModo('redefinir');
    } catch {
      setErro('Erro de comunicação. Tente novamente.');
    } finally {
      setEnviando(false);
    }
  };

  const submitRedefinir = async (e: FormEvent) => {
    e.preventDefault();
    resetEstado();
    if (novaSenha !== confirmaSenha) {
      setErro('As senhas não conferem.');
      return;
    }
    setEnviando(true);
    try {
      const res = await api.auth.redefinirComToken({
        email: email.trim(),
        codigo: codigo.trim(),
        novaSenha,
      });
      if (!res.ok) {
        setErro(res.error ?? 'Falha ao redefinir');
        return;
      }
      setInfo('Senha redefinida com sucesso! Você já pode entrar com a nova senha.');
      // Limpa campos de reset e volta para o login.
      setCodigo('');
      setNovaSenha('');
      setConfirmaSenha('');
      setModo('login');
    } catch {
      setErro('Erro de comunicação. Tente novamente.');
    } finally {
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
        {info && <div className="alert alert-success">{info}</div>}

        {modo === 'login' && (
          <form onSubmit={submitLogin}>
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
            <button
              type="button"
              onClick={() => {
                resetEstado();
                setModo('solicitar');
              }}
              style={{
                width: '100%',
                marginTop: 8,
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Esqueceu a senha?
            </button>
          </form>
        )}

        {modo === 'solicitar' && (
          <form onSubmit={submitSolicitar}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
              Informe seu e-mail cadastrado. Enviaremos um código de verificação.
            </p>
            <div className="form-row">
              <label>E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                autoComplete="email"
              />
            </div>
            <button
              type="submit"
              className="btn-primary"
              disabled={enviando || !email.trim()}
              style={{ width: '100%', marginTop: 6 }}
            >
              {enviando ? 'Enviando…' : 'Enviar código'}
            </button>
            <button
              type="button"
              onClick={() => {
                resetEstado();
                setModo('login');
              }}
              style={{
                width: '100%',
                marginTop: 8,
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Voltar para o login
            </button>
          </form>
        )}

        {modo === 'redefinir' && (
          <form onSubmit={submitRedefinir}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
              Digite o código de 6 dígitos recebido por e-mail e sua nova senha.
            </p>
            <div className="form-row">
              <label>E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div className="form-row">
              <label>Código (6 dígitos)</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                style={{ letterSpacing: 4, fontFamily: 'monospace', fontSize: 18 }}
                autoFocus
              />
            </div>
            <div className="form-row">
              <label>Nova senha (mín. 6 caracteres)</label>
              <input
                type="password"
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="form-row">
              <label>Confirmar nova senha</label>
              <input
                type="password"
                value={confirmaSenha}
                onChange={(e) => setConfirmaSenha(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <button
              type="submit"
              className="btn-primary"
              disabled={enviando || !email.trim() || codigo.length !== 6 || !novaSenha}
              style={{ width: '100%', marginTop: 6 }}
            >
              {enviando ? 'Redefinindo…' : 'Redefinir senha'}
            </button>
            <button
              type="button"
              onClick={() => {
                resetEstado();
                setModo('solicitar');
              }}
              style={{
                width: '100%',
                marginTop: 8,
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Reenviar código
            </button>
          </form>
        )}

        {modo === 'login' && !info && (
          <p
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              textAlign: 'center',
              marginTop: 18,
              marginBottom: 0,
            }}
          >
            Network for Education and Academic Excellence Class
          </p>
        )}
      </div>
    </div>
  );
}
