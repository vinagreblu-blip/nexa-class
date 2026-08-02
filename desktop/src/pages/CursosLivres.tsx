import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Aluno } from '../types';
import { NovoAlunoModal } from '../components/NovoAlunoModal';
import { ConfirmDialog } from '../components/Modal';

type SubAba = 'menu' | 'livres' | 'extensao' | 'livres-alunos';

export function CursosLivres() {
  const [aba, setAba] = useState<SubAba>('menu');

  if (aba === 'livres') return <CursosLivresInterno onVoltar={() => setAba('menu')} onAlunos={() => setAba('livres-alunos')} />;
  if (aba === 'livres-alunos') return <AlunosInterno onVoltar={() => setAba('livres')} />;
  if (aba === 'extensao') return <CursosExtensaoInterno onVoltar={() => setAba('menu')} />;

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      <CardCurso cor="#2563EB" corClara="#DBEAFE" corBotao="#2563EB" titulo="Cursos Livres" descricao="Gerencie os cursos livres oferecidos pela instituição." onClick={() => setAba('livres')}
        icone={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>} />
      <CardCurso cor="#22C55E" corClara="#DCFCE7" corBotao="#22C55E" titulo="Cursos de Extensão" descricao="Gerencie os cursos de extensão e suas atividades." onClick={() => setAba('extensao')}
        icone={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c3 3 9 3 12 0v-5" /></svg>} />
    </div>
  );
}

// ============================================================
// CARD GENÉRICO
// ============================================================
function CardCurso({ cor, corClara, corBotao, titulo, descricao, onClick, icone }: {
  cor: string; corClara: string; corBotao: string; titulo: string; descricao: string; onClick: () => void; icone: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const [btnHover, setBtnHover] = useState(false);
  // ID estável p/ o gradiente SVG (anteriormente usava `${cor}` com '#' — inválido em selector/url()).
  const gradId = `g-${cor.replace('#', '')}`;
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ flex: 1, minWidth: 280, background: 'var(--surface)', borderRadius: 20, boxShadow: hover ? '0 4px 8px rgba(0,0,0,0.06), 0 20px 50px rgba(0,0,0,0.08)' : '0 1px 3px rgba(0,0,0,0.04), 0 10px 30px rgba(0,0,0,0.04)', padding: '44px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', position: 'relative', overflow: 'hidden', transform: hover ? 'translateY(-6px)' : 'translateY(0)', transition: 'box-shadow 0.25s ease, transform 0.25s ease' }}>
      <svg style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '20%', opacity: 0.5 }} viewBox="0 0 400 100" preserveAspectRatio="none">
        <defs><linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={corClara} stopOpacity="0" /><stop offset="100%" stopColor={corClara} stopOpacity="0.7" /></linearGradient></defs>
        <path d="M0,50 C80,90 160,10 240,50 C320,85 400,40 400,40 L400,100 L0,100 Z" fill={`url(#${gradId})`} />
        <path d="M0,70 C60,40 180,100 280,60 C340,35 400,70 400,70 L400,100 L0,100 Z" fill={`url(#${gradId})`} opacity="0.4" />
      </svg>
      <div style={{ width: 80, height: 80, borderRadius: '50%', background: corClara, display: 'flex', alignItems: 'center', justifyContent: 'center', color: cor, marginBottom: 24, position: 'relative', zIndex: 1 }}>{icone}</div>
      <h2 style={{ margin: '0 0 10px', fontSize: 22, fontWeight: 700, color: 'var(--text)', position: 'relative', zIndex: 1 }}>{titulo}</h2>
      <p style={{ margin: '0 0 32px', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6, maxWidth: 300, position: 'relative', zIndex: 1 }}>{descricao}</p>
      <button onClick={onClick} onMouseEnter={() => setBtnHover(true)} onMouseLeave={() => setBtnHover(false)}
        style={{ background: corBotao, color: '#FFFFFF', border: 'none', borderRadius: 10, padding: '12px 28px', fontSize: 15, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: hover ? `0 6px 20px ${corBotao}50` : `0 4px 14px ${corBotao}30`, transform: btnHover ? 'scale(1.03)' : 'scale(1)', transition: 'transform 0.2s ease, box-shadow 0.25s ease', position: 'relative', zIndex: 1 }}>
        Acessar
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: btnHover ? 'translateX(4px)' : 'translateX(0)', transition: 'transform 0.2s ease' }}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
      </button>
    </div>
  );
}

// ============================================================
// PAINEL CURSOS LIVRES (3 cards)
// ============================================================
function CursosLivresInterno({ onVoltar, onAlunos }: { onVoltar: () => void; onAlunos: () => void }) {
  const cards = [
    { cor: '#2563EB', corClara: '#DBEAFE', titulo: 'Alunos', desc: 'Gerencie alunos, matrículas, histórico acadêmico e informações cadastrais.', onClick: onAlunos,
      icon: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></> },
    { cor: '#22C55E', corClara: '#DCFCE7', titulo: 'Cursos', desc: 'Cadastre cursos, módulos, disciplinas, conteúdos e configurações.', onClick: () => {},
      icon: <><path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c3 3 9 3 12 0v-5" /></> },
    { cor: '#8B5CF6', corClara: '#EDE9FE', titulo: 'Certificados', desc: 'Emita, valide e acompanhe certificados digitais dos alunos.', onClick: () => {},
      icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="15" x2="15" y2="15" /></> },
  ];
  return (
    <div>
      <button className="btn-ghost" style={{ marginBottom: 16, padding: '6px 14px', fontSize: 13 }} onClick={onVoltar}>← Voltar</button>
      <div style={{ marginBottom: 36 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>Painel de Cursos Livres</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 15 }}>Escolha um módulo para começar.</p>
      </div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {cards.map((c) => <PainelCard key={c.titulo} {...c} />)}
      </div>
    </div>
  );
}

function PainelCard({ cor, corClara, titulo, desc, icon, onClick }: {
  cor: string; corClara: string; titulo: string; desc: string; icon: React.ReactNode; onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [btnHover, setBtnHover] = useState(false);
  const gradId = `wg-${titulo.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ flex: 1, minWidth: 280, background: 'var(--surface)', borderRadius: 20, boxShadow: hover ? '0 4px 8px rgba(0,0,0,0.06), 0 20px 50px rgba(0,0,0,0.10)' : '0 1px 3px rgba(0,0,0,0.05), 0 8px 24px rgba(0,0,0,0.05)', padding: '40px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', position: 'relative', overflow: 'hidden', transform: hover ? 'translateY(-6px)' : 'translateY(0)', transition: 'box-shadow 0.25s ease, transform 0.25s ease' }}>
      <svg style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '20%' }} viewBox="0 0 400 100" preserveAspectRatio="none">
        <defs><linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={corClara} stopOpacity="0" /><stop offset="100%" stopColor={corClara} stopOpacity="0.8" /></linearGradient></defs>
        <path d="M0,40 C60,80 140,10 220,50 C300,85 380,30 400,40 L400,100 L0,100 Z" fill={`url(#${gradId})`} />
        <path d="M0,60 C50,30 170,95 250,55 C320,25 400,60 400,60 L400,100 L0,100 Z" fill={`url(#${gradId})`} opacity="0.4" />
      </svg>
      <div style={{ width: 80, height: 80, borderRadius: '50%', background: corClara, display: 'flex', alignItems: 'center', justifyContent: 'center', color: cor, marginBottom: 24, position: 'relative', zIndex: 1 }}>
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      </div>
      <h2 style={{ margin: '0 0 10px', fontSize: 20, fontWeight: 700, color: 'var(--text)', position: 'relative', zIndex: 1 }}>{titulo}</h2>
      <p style={{ margin: '0 0 28px', color: 'var(--text-muted)', fontSize: 13.5, lineHeight: 1.6, maxWidth: 280, position: 'relative', zIndex: 1, flex: 1 }}>{desc}</p>
      <button onClick={onClick} onMouseEnter={() => setBtnHover(true)} onMouseLeave={() => setBtnHover(false)}
        style={{ background: cor, color: '#fff', border: 'none', borderRadius: 10, padding: '11px 26px', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: hover ? `0 6px 20px ${cor}50` : `0 3px 12px ${cor}25`, transform: btnHover ? 'scale(1.03)' : 'scale(1)', transition: 'transform 0.2s ease, box-shadow 0.25s ease', position: 'relative', zIndex: 1 }}>
        Acessar
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: btnHover ? 'translateX(4px)' : 'translateX(0)', transition: 'transform 0.2s ease' }}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
      </button>
    </div>
  );
}

// ============================================================
// GESTÃO DE ALUNOS
// ============================================================
function AlunosInterno({ onVoltar }: { onVoltar: () => void }) {
  const [alunos, setAlunos] = useState<Aluno[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [excluirId, setExcluirId] = useState<number | null>(null);
  const [pagina, setPagina] = useState(1);
  const porPagina = 10;

  async function carregar(termo?: string) {
    setCarregando(true);
    const res = await api.alunos.listar(termo, 'cursos_livres');
    if (res.ok && res.data) setAlunos(res.data);
    setCarregando(false);
  }

  // Busca inicial + debounce (um único useEffect para evitar fetch duplicado no mount).
  useEffect(() => {
    const t = setTimeout(() => carregar(busca), 250);
    return () => clearTimeout(t);
  }, [busca]);

  async function confirmarExclusao() {
    if (excluirId === null) return;
    const id = excluirId;
    setExcluirId(null);
    const res = await api.alunos.excluir(id);
    if (res.ok) {
      setSucesso('Aluno excluído.');
      setTimeout(() => setSucesso(null), 3000);
      await carregar(busca);
    } else {
      setErro(res.error ?? 'Erro ao excluir');
    }
  }

  const total = alunos.length;
  const totalPaginas = Math.ceil(total / porPagina) || 1;
  const inicio = (pagina - 1) * porPagina;
  const alunosPagina = alunos.slice(inicio, inicio + porPagina);

  function getStatus(a: Aluno): { label: string; cor: string; bg: string } {
    if (a.ano_conclusao && a.ano_conclusao !== 'Cursando') return { label: 'Concluído', cor: '#15803D', bg: '#DCFCE7' };
    if (!a.ano_ingresso) return { label: 'Pendente', cor: '#A16207', bg: '#FEF3C7' };
    return { label: 'Ativo', cor: '#15803D', bg: '#DCFCE7' };
  }

  return (
    <div>
      {/* Cabeçalho */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: 13 }} onClick={onVoltar}>←</button>
            <div>
              <h1 style={{ margin: '0 0 4px', fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>Alunos</h1>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14 }}>Gerencie os alunos cadastrados na instituição.</p>
            </div>
          </div>
        </div>
        <button onClick={() => { setErro(null); setModalAberto(true); }}
          style={{ background: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: '0 3px 12px #2563EB25', transition: 'transform 0.2s ease, box-shadow 0.2s ease' }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.03)'; e.currentTarget.style.boxShadow = '0 6px 20px #2563EB40'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 3px 12px #2563EB25'; }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Novo Aluno
        </button>
      </div>

      {sucesso && <div className="alert alert-success" style={{ marginBottom: 16 }}>{sucesso}</div>}
      {erro && <div className="alert alert-error" style={{ marginBottom: 16 }}>{erro}</div>}

      {/* Barra de pesquisa */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <svg style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input placeholder="Pesquisar aluno por nome, CPF ou matrícula" value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(1); }}
            style={{ width: '100%', padding: '11px 14px 11px 42px', border: '1px solid var(--border)', borderRadius: 10, fontSize: 14, background: 'var(--surface)', color: 'var(--text)', outline: 'none', transition: 'border-color 0.2s' }}
            onFocus={(e) => e.currentTarget.style.borderColor = 'var(--primary)'}
            onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border)'} />
        </div>
      </div>

      {/* Tabela */}
      <div style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface-alt)', borderBottom: '1px solid var(--border)' }}>
                {['Nome', 'Matrícula', 'CPF', 'Curso', 'Situação', 'Cadastro', 'Ações'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {carregando && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Carregando…</td></tr>}
              {!carregando && alunosPagina.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Nenhum aluno encontrado.</td></tr>}
              {alunosPagina.map((a, i) => {
                const st = getStatus(a);
                return (
                  <tr key={a.id} style={{ borderBottom: i === alunosPagina.length - 1 ? 'none' : '1px solid var(--surface-hover)', transition: 'background 0.15s' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{a.nome}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{a.matricula}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)' }}>{a.cpf || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)' }}>{a.curso || '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: st.bg, color: st.cor }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.cor }} />
                        {st.label}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)' }}>{a.created_at ? new Date(a.created_at).toLocaleDateString('pt-BR') : '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button title="Excluir" onClick={() => setExcluirId(a.id)} style={{ padding: 6, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: '#EF4444', transition: 'background 0.15s' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.15)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--surface-hover)' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Mostrando {total === 0 ? 0 : inicio + 1}–{Math.min(inicio + porPagina, total)} de {total} alunos
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button disabled={pagina === 1} onClick={() => setPagina(p => p - 1)} style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', cursor: pagina === 1 ? 'default' : 'pointer', color: pagina === 1 ? 'var(--text-muted)' : 'var(--text-muted)', fontSize: 13, opacity: pagina === 1 ? 0.5 : 1 }}>◀</button>
            {(() => {
              // Janela deslizante: mostra até 5 páginas em torno da atual.
              const win = 5;
              let start = Math.max(1, pagina - Math.floor(win / 2));
              const end = Math.min(totalPaginas, start + win - 1);
              start = Math.max(1, end - win + 1);
              const pages: number[] = [];
              for (let p = start; p <= end; p++) pages.push(p);
              return pages.map((p) => (
                <button key={p} onClick={() => setPagina(p)} style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, background: pagina === p ? 'var(--primary)' : 'var(--surface)', color: pagina === p ? '#fff' : 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{p}</button>
              ));
            })()}
            <button disabled={pagina >= totalPaginas} onClick={() => setPagina(p => p + 1)} style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', cursor: pagina >= totalPaginas ? 'default' : 'pointer', color: pagina >= totalPaginas ? 'var(--text-muted)' : 'var(--text-muted)', fontSize: 13, opacity: pagina >= totalPaginas ? 0.5 : 1 }}>▶</button>
          </div>
        </div>
      </div>

      {/* Confirmar exclusão */}
      {excluirId !== null && (
        <ConfirmDialog
          title="Excluir aluno"
          message="Tem certeza que deseja excluir este aluno? Esta ação não pode ser desfeita."
          confirmLabel="Excluir"
          onConfirm={confirmarExclusao}
          onCancel={() => setExcluirId(null)}
        />
      )}

      {/* Modal Novo Aluno */}
      <NovoAlunoModal aberto={modalAberto} origem="cursos_livres" onClose={() => setModalAberto(false)} onSalvo={async () => { setModalAberto(false); setSucesso('Aluno cadastrado!'); setTimeout(() => setSucesso(null), 3000); await carregar(busca); }} />
    </div>
  );
}

// ============================================================
function CursosExtensaoInterno({ onVoltar }: { onVoltar: () => void }) {
  return (
    <div>
      <button className="btn-ghost" style={{ marginBottom: 16, padding: '6px 14px', fontSize: 13 }} onClick={onVoltar}>← Voltar</button>
      <h1 style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 700, color: 'var(--text)' }}>Cursos de Extensão</h1>
      <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14 }}>Gerencie os cursos de extensão e suas atividades.</p>
    </div>
  );
}
