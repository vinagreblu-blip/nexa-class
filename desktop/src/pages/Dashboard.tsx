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
  const [revogandoId, setRevogandoId] = useState<string | null>(null);

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

  const revogar = async (machineId: string) => {
    if (!confirm('Revogar esta máquina? Ela vai parar de sincronizar na próxima verificação.')) {
      return;
    }
    setRevogandoId(machineId);
    try {
      const res = await api.auth.dashboard.revogar(machineId);
      if (!res.ok) {
        alert(res.error ?? 'Falha ao revogar');
      } else {
        await carregar();
      }
    } finally {
      setRevogandoId(null);
    }
  };

  useEffect(() => {
    carregar();
    // Atualiza a cada 15s enquanto a aba está aberta — casando com o intervalo
    // do sync bidirecional do cloud.ts (latência natural dos dados da nuvem).
    const id = setInterval(carregar, 15_000);
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

      <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-muted)' }}>
        Atividade de todas as máquinas — atualiza automaticamente a cada ~15s (sync da nuvem).
      </p>

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
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <Painel titulo="Alunos cadastrados recentemente">
          {metricas.atividadeRecente.alunos.length === 0 ? (
            <Vazio>Nenhum aluno cadastrado.</Vazio>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Aluno</th>
                  <th>Curso</th>
                  <th>Por</th>
                  <th>Quando</th>
                </tr>
              </thead>
              <tbody>
                {metricas.atividadeRecente.alunos.map((a, i) => (
                  <tr key={i}>
                    <td>
                      <NovoBadge ts={a.created_at} /> {a.nome}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.matricula}</div>
                    </td>
                    <td>{a.curso ?? '—'}</td>
                    <td>{a.cadastrado_por_nome ?? '—'}</td>
                    <td>{a.created_at ? formatarData(a.created_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Painel>

        <Painel titulo="Declarações recentes">
          {metricas.atividadeRecente.declaracoes.length === 0 ? (
            <Vazio>Nenhuma declaração emitida.</Vazio>
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
                    <td>
                      <NovoBadge ts={d.emitido_em} /> {d.aluno_nome}
                    </td>
                    <td>{d.emitido_por_nome}</td>
                    <td>{formatarData(d.emitido_em)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Painel>

        <Painel titulo="Diplomas recentes">
          {metricas.atividadeRecente.diplomas.length === 0 ? (
            <Vazio>Nenhum diploma emitido.</Vazio>
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
                {metricas.atividadeRecente.diplomas.map((d, i) => (
                  <tr key={i}>
                    <td>
                      <NovoBadge ts={d.emitido_em} /> {d.aluno_nome}
                    </td>
                    <td>{d.emitido_por_nome}</td>
                    <td>{formatarData(d.emitido_em)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Painel>

        <Painel titulo="Atas de colação recentes">
          {metricas.atividadeRecente.atas.length === 0 ? (
            <Vazio>Nenhuma ata gerada.</Vazio>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Aluno</th>
                  <th>Quando</th>
                </tr>
              </thead>
              <tbody>
                {metricas.atividadeRecente.atas.map((d, i) => (
                  <tr key={i}>
                    <td>
                      <NovoBadge ts={d.emitido_em} /> {d.aluno_nome}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.aluno_matricula}</div>
                    </td>
                    <td>{d.emitido_em ? formatarData(d.emitido_em) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Painel>

        <Painel titulo="Cursos livres criados recentemente">
          {metricas.atividadeRecente.cursosLivres.length === 0 ? (
            <Vazio>Nenhum curso livre criado.</Vazio>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Curso</th>
                  <th>CH</th>
                  <th>Quando</th>
                </tr>
              </thead>
              <tbody>
                {metricas.atividadeRecente.cursosLivres.map((c, i) => (
                  <tr key={i}>
                    <td>
                      <NovoBadge ts={c.created_at} /> {c.nome}
                    </td>
                    <td>{c.carga_horaria ?? '—'}</td>
                    <td>{formatarData(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Painel>

        <Painel titulo="Matrículas em cursos livres">
          {metricas.atividadeRecente.matriculasCursosLivres.length === 0 ? (
            <Vazio>Nenhuma matrícula recente.</Vazio>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Aluno</th>
                  <th>Curso</th>
                  <th>Quando</th>
                </tr>
              </thead>
              <tbody>
                {metricas.atividadeRecente.matriculasCursosLivres.map((m, i) => (
                  <tr key={i}>
                    <td>
                      <NovoBadge ts={m.created_at} /> {m.aluno_nome}
                    </td>
                    <td>{m.curso_nome}</td>
                    <td>{formatarData(m.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Painel>

        <Painel titulo="Usuários ativos recentemente">
          {metricas.atividadeRecente.usuarios.length === 0 ? (
            <Vazio>Nenhum usuário.</Vazio>
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
                    <td>
                      <NovoBadge ts={u.updated_at} /> {u.nome}
                    </td>
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
      </div>

      {/* Máquinas instaladas (painel de revogação) */}
      <div style={{ marginBottom: 24 }}>
        <Painel titulo="Máquinas com acesso à nuvem">
          {metricas.instalacoes.length === 0 ? (
            <Vazio>Nenhuma máquina registrada ainda (ou nuvem offline).</Vazio>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Máquina</th>
                  <th>Hostname</th>
                  <th>Versão</th>
                  <th>Última atividade</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {metricas.instalacoes.map((m) => {
                  const souEu = m.machine_id === metricas.status.cloudAuth.machineId;
                  return (
                    <tr key={m.machine_id}>
                      <td>
                        <code style={{ fontSize: 11 }}>{m.machine_id}</code>
                        {souEu && (
                          <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--accent)' }}>
                            (este computador)
                          </span>
                        )}
                      </td>
                      <td>{m.hostname ?? '—'}</td>
                      <td>{m.app_versao ?? '—'}</td>
                      <td>{m.last_seen ? formatarData(m.last_seen) : '—'}</td>
                      <td>
                        {m.revoked === 1 ? (
                          <span style={{ color: '#dc2626', fontWeight: 600 }}>Revogada</span>
                        ) : (
                          <span style={{ color: '#16a34a' }}>Ativa</span>
                        )}
                      </td>
                      <td>
                        {m.revoked === 1 ? null : (
                          <button
                            className="btn-ghost"
                            disabled={revogandoId === m.machine_id}
                            onClick={() => revogar(m.machine_id)}
                            style={{ fontSize: 12, color: '#dc2626' }}
                          >
                            {revogandoId === m.machine_id ? 'Revogando…' : 'Revogar'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p style={{ margin: '12px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
            Revogação aqui é <strong>soft</strong> (a máquina para de sincronizar). Para bloqueio
            imediato, delete o usuário em{' '}
            <a
              href="https://supabase.com/dashboard/project/evapmgnwznybylbtjmco/auth/users"
              target="_blank"
              rel="noopener noreferrer"
            >
              Supabase → Authentication → Users
            </a>{' '}
            (revogação hard).
          </p>
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
            label="Autenticação da nuvem"
            ok={metricas.status.cloudAuth.autenticado && !metricas.status.cloudAuth.revogada}
            texto={
              metricas.status.cloudAuth.revogada
                ? '⚠️ Esta máquina foi revogada — sync desativado'
                : metricas.status.cloudAuth.autenticado
                  ? `Autenticada: ${metricas.status.cloudAuth.identityEmail ?? '—'}`
                  : metricas.status.cloudAuth.ultimoErro ?? 'Não autenticada'
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

function Vazio({ children }: { children: React.ReactNode }) {
  return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{children}</p>;
}

/** Janela de tempo para considerar um registro como "NOVO" (60s). */
const JANELA_NOVO_MS = 60_000;

/** Converte timestamp (ISO ou formato SQLite UTC) para milissegundos desde epoch. */
function paraMs(ts: string | null): number | null {
  if (!ts) return null;
  // SQLite guarda datetime('now') em UTC sem sufixo; adiciona 'T' e 'Z'.
  const normalizado = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
  const t = new Date(normalizado).getTime();
  return Number.isNaN(t) ? null : t;
}

function ehNovo(ts: string | null): boolean {
  const t = paraMs(ts);
  if (t === null) return false;
  return Date.now() - t < JANELA_NOVO_MS && Date.now() - t >= -5_000;
}

function NovoBadge({ ts }: { ts: string | null }) {
  if (!ehNovo(ts)) return null;
  return (
    <span
      style={{
        display: 'inline-block',
        marginRight: 6,
        padding: '1px 6px',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: 0.5,
        color: '#fff',
        background: '#16a34a',
        borderRadius: 999,
        verticalAlign: 'middle',
        textTransform: 'uppercase',
      }}
      aria-label="Cadastrado há menos de 1 minuto"
    >
      Novo
    </span>
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
