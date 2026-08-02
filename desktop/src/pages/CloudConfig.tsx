import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

export function CloudConfig() {
  const { usuario } = useAuth();
  const isAdmin = usuario?.role === 'admin';
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [syncedCount, setSyncedCount] = useState<number | null>(null);

  async function carregar() {
    setCarregando(true);
    const res = await api.cloud.status();
    if (res.ok && res.data) {
      setUrl(res.data.url);
      setKey('');
      setEnabled(res.data.enabled);
    }
    setCarregando(false);
  }

  useEffect(() => { carregar(); }, []);

  async function salvar() {
    setErro(null);
    setSucesso(null);
    setSalvando(true);
    const res = await api.cloud.salvar({ url: url.trim(), key: key.trim(), enabled });
    setSalvando(false);
    if (res.ok) {
      setSucesso(enabled ? 'Nuvem ativada! Os dados serão sincronizados entre todos os computadores.' : 'Nuvem desativada.');
      setTimeout(() => setSucesso(null), 5000);
    } else {
      setErro(res.error ?? 'Erro ao salvar configuração');
    }
  }

  async function sincronizar() {
    setErro(null);
    setSucesso(null);
    setSincronizando(true);
    const res = await api.cloud.sync();
    setSincronizando(false);
    if (res.ok && res.data) {
      setSyncedCount(res.data.synced);
      setSucesso(`${res.data.synced} registros sincronizados da nuvem!`);
      setTimeout(() => setSucesso(null), 5000);
    } else {
      setErro(res.error ?? 'Erro ao sincronizar');
    }
  }

  if (!isAdmin) {
    return (
      <div style={{ maxWidth: 600 }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Nuvem</h1>
        <div className="alert alert-warning">Apenas administradores podem configurar a nuvem.</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22 }}>Nuvem (Supabase)</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
          Configure a sincronização na nuvem para que todos os computadores compartilhem os mesmos dados.
        </p>
      </div>

      {sucesso && <div className="alert alert-success">{sucesso}</div>}
      {erro && <div className="alert alert-error">{erro}</div>}

      {!carregando && (
        <div className="card" style={{ padding: 22, marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span className={enabled ? 'badge badge-ok' : 'badge badge-pendente'}>
              {enabled ? '☁️ Nuvem Ativa' : '⚠️ Nuvem Desativada'}
            </span>
            {enabled && syncedCount !== null && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Última sync: {syncedCount} registros
              </span>
            )}
          </div>

          <div className="form-row">
            <label>Supabase URL *</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://xxxxxxxx.supabase.co"
            />
          </div>

          <div className="form-row">
            <label>Supabase Anon Key *</label>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
              type="password"
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Encontre em: Supabase → Settings → API → Project URL e anon public key
            </div>
          </div>

          <div className="form-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                style={{ width: 'auto' }}
              />
              Ativar sincronização na nuvem
            </label>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn-primary" onClick={salvar} disabled={salvando}>
              {salvando ? 'Salvando…' : 'Salvar Configuração'}
            </button>
            {enabled && (
              <button className="btn-ghost" onClick={sincronizar} disabled={sincronizando}>
                {sincronizando ? 'Sincronizando…' : '⬇️ Sincronizar Agora'}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Como configurar (5 minutos)</h3>
        <ol style={{ margin: 0, paddingLeft: 20, color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.8 }}>
          <li>Acesse <strong>supabase.com</strong> e crie uma conta (grátis)</li>
          <li>Clique em <strong>"New Project"</strong> → dê um nome (ex: nexa-class)</li>
          <li>Após criar, vá em <strong>SQL Editor</strong></li>
          <li>Cole TODO o conteúdo do arquivo <code>supabase-schema.sql</code> (na pasta do projeto)</li>
          <li>Clique em <strong>Run</strong> para criar as tabelas</li>
          <li>Vá em <strong>Settings → API</strong></li>
          <li>Copie a <strong>Project URL</strong> e a <strong>anon public key</strong></li>
          <li>Cole nos campos acima e clique em <strong>Salvar</strong></li>
        </ol>
      </div>

      <div className="card" style={{ padding: 18, marginTop: 18 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Como funciona</h3>
        <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.8 }}>
          <li><strong>Ao cadastrar/editar/excluir</strong> no sistema → os dados vão para a nuvem automaticamente</li>
          <li><strong>Ao abrir o app</strong> → baixa os dados mais recentes da nuvem</li>
          <li><strong>Vários computadores</strong> conectados ao mesmo Supabase veem os mesmos dados</li>
          <li><strong>Funciona offline</strong> — as mudanças ficam locais e sincronizam quando voltar a internet</li>
          <li>Botão <strong>"Sincronizar Agora"</strong> força a atualização imediata</li>
        </ul>
      </div>
    </div>
  );
}
