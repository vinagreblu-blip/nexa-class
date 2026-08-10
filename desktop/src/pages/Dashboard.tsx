import { useEffect, useState } from 'react';
import { api } from '../api';
import type { MetricasDashboard } from '../api';

/**
 * Dashboard admin: contadores, atividade recente e status do sistema.
 * Visível apenas para admin (handler tem `requerAdmin`).
 */
export function Dashboard() {
  const [metricas, setMetricas] = useState<MetricasDashboard | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await api.auth.dashboard.obter();
      if (res.ok && res.data) setMetricas(res.data);
      else setErro(res.error ?? 'Falha ao carregar métricas');
    } catch {
      setErro('Erro de comunicação');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
    // Atualiza a cada 30s enquanto a aba está aberta.
    const id = setInterval(carregar, 30_000);
    return () => clearInterval(id);
  }, []);

  if (carregando && !metricas) {
    return <p style={{ color: 'var(--text-muted)' }}>Carregando métricas…</p>;
  }
  if (erro && !metricas) {
    return (
      <div>
        <div className="alert alert-error">{erro}</div>
        <button onClick={carregar} className="btn-primary">
          Tentar novamente
        </button>
      </div>
    );
  }
  if (!metricas) return null;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <h2 style={{ margin: 0 }}>Dashboard</h2>
        <button onClick={carregar} className="btn-ghost" disabled={carregando}>
          {carregando ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>

      {erro && <div className="alert alert-error" style={{ marginBottom: 16 }}>{erro}</div>}

      {/* Cards superiores — contadores */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <Card label="Alunos" valor={metricas.contadores.alunos} />
        <Card label="Usuários ativos" valor={metricas.contadores.usuariosAtivos} />
        <Card label="Declarações" valor={metricas.contadores.declaracoes} />
        <Card label="Diplomas" valor={metricas.contadores.diplomas} />
        <Card label="Docentes" valor={metricas.contadores.docentes} />
        <Card label="Disciplinas" valor={metricas.contadores.disciplinas} />
        <Card label="Cursos livres" valor={metricas.contadores.cursosLivres} />
      </div>

      {/* Atividade recente */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        <Painel titulo="Usuários ativos recentemente">
          {metricas.atividadeRecente.usuarios.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Nenhum usuário.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Role</th>
                  <th>Última atualização</th>
                </tr>
              </thead>
              <tbody>
                {metricas.atividadeRecente.usuarios.map((u) => (
                  <tr key={u.username}>
                    <td>{u.nome}</td>
                    <td>
                      <code>{u.role}</code>
                    </td>
                    <td>{u.updated_at ? formatarData(u.updated_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Painel>

        <Painel titulo="Declarações recentes">
          {metricas.atividadeRecente.declaracoes.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              Nenhuma declaração emitida.
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Aluno</th>
                  <th>Emitido por</th>
                  <th>Quando</th>
                </tr>
              </thead>
              <tbody>
                {metricas.atividadeRecente.declaracoes.map((d, i) => (
                  <tr key={i}>
                    <td>{d.aluno_nome}</td>
                    <td>{d.emitido_por_nome}</td>
                    <td>{formatarData(d.emitido_em)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Painel>
      </div>

      {/* Status do sistema */}
      <Painel titulo="Status do sistema">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <ItemStatus
            label="Cloud sync (Supabase)"
            ok={metricas.status.cloudSync.ativo}
            texto={
              metricas.status.cloudSync.ativo
                ? metricas.status.cloudSync.ultimoSyncEm
                  ? `Último sync: ${formatarData(metricas.status.cloudSync.ultimoSyncEm)} ${
                      metricas.status.cloudSync.ultimoSyncOk === false ? '(falhou)' : '(ok)'
                    }`
                  : 'Ativo, ainda não sincronizou'
                : 'Inativo'
            }
          />
          <ItemStatus
            label="SMTP (recuperação por e-mail)"
            ok={metricas.status.smtp}
            texto={metricas.status.smtp ? 'Configurado' : 'Não configurado'}
          />
          <ItemStatus
            label="Sentry (captura de erros)"
            ok={metricas.status.sentry}
            texto={metricas.status.sentry ? 'Ativo (DSN configurada)' : 'Inativo (sem DSN)'}
          />
          <ItemStatus
            label="API key de verificação"
            ok={metricas.status.apiKeyForte}
            texto={
              metricas.status.apiKeyForte
                ? 'Forte (não é o default)'
                : '⚠️ Usa default público — configure API key'
            }
          />
          <ItemStatus
            label="Senha master (operações críticas)"
            ok={metricas.status.senhaMasterForte}
            texto={
              metricas.status.senhaMasterForte
                ? 'Forte (gerada por instalação)'
                : '⚠️ Usa hash dev público — rotacione via SENHA_EXCLUSAO_DECLARACAO_HASH'
            }
          />
          <ItemStatus
            label="Espaço usado (userData)"
            ok
            texto={formatarBytes(metricas.status.userDataBytes)}
          />
          <ItemStatus label="Versão do app" ok texto={metricas.status.appVersao} />
        </div>
      </Painel>
    </div>
  );
}

function Card({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="card" style={{ padding: 16, textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent)' }}>{valor}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
    </div>
  );
}

function Painel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)' }}>
        {titulo}
      </h3>
      {children}
    </div>
  );
}

function ItemStatus({ label, ok, texto }: { label: string; ok: boolean; texto: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, background: 'var(--bg-alt)', borderRadius: 6 }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: ok ? '#16a34a' : '#dc2626',
          flexShrink: 0,
        }}
        aria-label={ok ? 'OK' : 'Atenção'}
      />
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{texto}</div>
      </div>
    </div>
  );
}

function formatarData(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatarBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const unidades = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${unidades[i]}`;
}
