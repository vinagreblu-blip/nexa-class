import { useEffect, useState } from 'react';
import { api } from '../api';

const PRESETS: Record<string, { label: string; ajuda: string }> = {
  gmail: { label: 'Gmail', ajuda: 'Use uma Senha de App (Google → Segurança → Verificação em 2 etapas → Senhas de app). NÃO use sua senha normal.' },
  outlook: { label: 'Outlook (Microsoft 365)', ajuda: 'Use a senha normal da sua conta Outlook.' },
  hotmail: { label: 'Hotmail', ajuda: 'Use a senha normal da sua conta Hotmail.' },
  yahoo: { label: 'Yahoo', ajuda: 'Gere uma Senha de App (Yahoo → Segurança → Senhas de app).' },
};

export function Configuracoes() {
  const [provedor, setProvedor] = useState('gmail');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [configurado, setConfigurado] = useState(false);

  async function carregar() {
    setCarregando(true);
    const res = await api.smtp.obter();
    if (res.ok && res.data) {
      setProvedor(res.data.provedor || 'gmail');
      setEmail(res.data.email || '');
      setSenha(res.data.senha || '');
      setConfigurado(true);
    } else {
      setConfigurado(false);
    }
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  async function salvar() {
    setErro(null);
    setSucesso(null);
    if (!email.trim()) {
      setErro('E-mail é obrigatório');
      return;
    }
    if (!senha.trim()) {
      setErro('Senha é obrigatória');
      return;
    }
    setSalvando(true);
    const res = await api.smtp.salvar({ provedor, email: email.trim(), senha: senha.trim() });
    setSalvando(false);
    if (res.ok) {
      setConfigurado(true);
      setSucesso('Configuração de e-mail salva com sucesso! O sistema já pode enviar e-mails de recuperação de senha.');
    } else {
      setErro(res.error ?? 'Erro ao salvar');
    }
  }

  const ajuda = PRESETS[provedor]?.ajuda ?? '';

  return (
    <div style={{ maxWidth: 600 }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22 }}>Configurações</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
          Configure o servidor de e-mail para envio de recuperação de senha.
        </p>
      </div>

      {sucesso && <div className="alert alert-success">{sucesso}</div>}
      {erro && <div className="alert alert-error">{erro}</div>}

      <div className="card" style={{ padding: 22 }}>
        {configurado && (
          <div className="alert alert-success" style={{ marginBottom: 16 }}>
            ✅ E-mail configurado: <strong>{email}</strong> ({PRESETS[provedor]?.label})
          </div>
        )}

        <div className="form-row">
          <label>Provedor de E-mail *</label>
          <select value={provedor} onChange={(e) => setProvedor(e.target.value)}>
            {Object.entries(PRESETS).map(([key, p]) => (
              <option key={key} value={key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {ajuda && (
          <div className="alert alert-warning" style={{ marginBottom: 14, fontSize: 12 }}>
            💡 {ajuda}
          </div>
        )}

        <div className="form-row">
          <label>E-mail *</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu@email.com"
          />
        </div>

        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>Senha / Senha de App *</label>
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        <button
          className="btn-primary"
          onClick={salvar}
          disabled={salvando || carregando}
          style={{ marginTop: 18 }}
        >
          {salvando ? 'Salvando…' : 'Salvar configuração'}
        </button>
      </div>

      <div className="card" style={{ padding: 18, marginTop: 18 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Como funciona a recuperação de senha?</h3>
        <ol style={{ margin: 0, paddingLeft: 20, color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.8 }}>
          <li>Na tela de Login, o usuário clica em <strong>"Recuperar senha"</strong></li>
          <li>Digita o e-mail cadastrado no seu perfil</li>
          <li>O sistema envia um e-mail com um <strong>link de redefinição</strong> (válido por 30 min)</li>
          <li>O usuário clica no link → abre uma página web → digita a nova senha</li>
          <li>A senha é atualizada e o usuário já pode fazer login</li>
        </ol>
      </div>
    </div>
  );
}
