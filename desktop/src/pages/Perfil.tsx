import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

export function Perfil() {
  const { usuario } = useAuth();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro(null);
    setSucesso(null);
    if (nova !== confirmar) {
      setErro('A confirmação não confere com a nova senha');
      return;
    }
    setSalvando(true);
    const res = await api.auth.alterarSenha(atual, nova);
    setSalvando(false);
    if (res.ok) {
      setSucesso('Senha alterada com sucesso.');
      setAtual('');
      setNova('');
      setConfirmar('');
    } else {
      setErro(res.error ?? 'Erro ao alterar senha');
    }
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 22 }}>Perfil</h1>
      <p style={{ margin: '0 0 22px', color: 'var(--text-muted)', fontSize: 13 }}>
        Dados do seu usuário e alteração de senha.
      </p>

      <div className="card" style={{ padding: 22, marginBottom: 18 }}>
        <div className="form-row">
          <label>Nome</label>
          <input value={usuario?.nome ?? ''} disabled />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>Usuário</label>
          <input value={usuario?.username ?? ''} disabled />
        </div>
      </div>

      <div className="card" style={{ padding: 22 }}>
        <h2 style={{ margin: '0 0 16px', fontSize: 16 }}>Alterar Senha</h2>
        {erro && <div className="alert alert-error">{erro}</div>}
        {sucesso && <div className="alert alert-success">{sucesso}</div>}
        <div className="form-row">
          <label>Senha atual</label>
          <input type="password" value={atual} onChange={(e) => setAtual(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Nova senha (mín. 6)</label>
          <input type="password" value={nova} onChange={(e) => setNova(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Confirmar nova senha</label>
          <input type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
        </div>
        <button
          className="btn-primary"
          onClick={salvar}
          disabled={salvando || !atual || !nova || !confirmar}
        >
          {salvando ? 'Salvando…' : 'Alterar senha'}
        </button>
      </div>
    </div>
  );
}
