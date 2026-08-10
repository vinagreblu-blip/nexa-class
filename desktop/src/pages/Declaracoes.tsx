import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import type { Aluno, DeclaracaoRow } from '../types';
import { Modal } from '../components/Modal';

interface DeclaracoesLabels {
  titulo: string;
  subtitulo: string;
  btnEmitir: string;
  btnEmitirSA: string;
  docSingular: string;
  docPlural: string;
}

const LABELS_PADRAO: DeclaracoesLabels = {
  titulo: 'Declarações de Autenticidade',
  subtitulo: 'Emita declarações em PDF com QR Code e código de verificação.',
  btnEmitir: '+ Emitir Nova Declaração',
  btnEmitirSA: '+ Emitir Nova Declaração (SA)',
  docSingular: 'Declaração',
  docPlural: 'declaração',
};

export function Declaracoes({ labels }: { labels?: Partial<DeclaracoesLabels> }) {
  const L = { ...LABELS_PADRAO, ...labels };
  const { usuario } = useAuth();
  const podeExcluir = usuario?.username === 'admin';
  const [historico, setHistorico] = useState<DeclaracaoRow[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [alunos, setAlunos] = useState<Aluno[]>([]);
  const [seletorAberto, setSeletorAberto] = useState(false);
  const [alunoSelecionado, setAlunoSelecionado] = useState<Aluno | null>(null);
  const [emitindo, setEmitindo] = useState(false);
  const [semAssinatura, setSemAssinatura] = useState(false);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [excluirAlvo, setExcluirAlvo] = useState<DeclaracaoRow | null>(null);
  const [senhaConfirmacao, setSenhaConfirmacao] = useState('');
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  async function carregarHistorico() {
    setCarregando(true);
    const res = await api.declaracoes.listar();
    if (res.ok && res.data) setHistorico(res.data);
    setCarregando(false);
  }

  async function carregarAlunos() {
    const res = await api.alunos.listar(busca);
    if (res.ok && res.data) setAlunos(res.data);
  }

  useEffect(() => {
    carregarHistorico();
  }, []);

  useEffect(() => {
    if (!seletorAberto) return;
    const t = setTimeout(() => carregarAlunos(), 200);
    return () => clearTimeout(t);
  }, [seletorAberto, busca]);

  function abrirSeletor() {
    setBusca('');
    setAlunoSelecionado(null);
    setErro(null);
    setSucesso(null);
    setSeletorAberto(true);
  }

  async function emitir() {
    if (!alunoSelecionado) return;
    setEmitindo(true);
    setErro(null);
    setSucesso(null);
    const res = await api.declaracoes.emitir(alunoSelecionado.id, semAssinatura);
    setEmitindo(false);
    if (res.ok && res.data) {
      setSeletorAberto(false);
      setSucesso(
        res.data.enviadoWeb
          ? `${L.docSingular} gerada com sucesso em: ${res.data.pdfPath}`
          : `${L.docSingular} gerada (não registrada no serviço web — verifique a conexão). PDF: ${res.data.pdfPath}`
      );
      await carregarHistorico();
    } else {
      setErro(res.error ?? `Erro ao emitir ${L.docPlural.toLowerCase()}`);
    }
  }

  function abrirExclusao(d: DeclaracaoRow) {
    setExcluirAlvo(d);
    setSenhaConfirmacao('');
    setErroExcluir(null);
  }

  async function confirmarExclusao() {
    if (!excluirAlvo) return;
    setExcluindo(true);
    setErroExcluir(null);
    const res = await api.declaracoes.excluir(excluirAlvo.id, senhaConfirmacao);
    setExcluindo(false);
    if (res.ok) {
      setExcluirAlvo(null);
      setSucesso(
        res.data?.webOk
          ? `${L.docSingular} excluída (local e no serviço de verificação).`
          : `${L.docSingular} excluída localmente (não foi possível remover do serviço web).`
      );
      await carregarHistorico();
      setTimeout(() => setSucesso(null), 4000);
    } else {
      setErroExcluir(res.error ?? `Erro ao excluir ${L.docPlural.toLowerCase()}`);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 22 }}>{L.titulo}</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
            {L.subtitulo}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-primary" onClick={() => { setSemAssinatura(false); abrirSeletor(); }}>
            {L.btnEmitir}
          </button>
          <button className="btn-ghost" onClick={() => { setSemAssinatura(true); abrirSeletor(); }}>
            {L.btnEmitirSA}
          </button>
        </div>
      </div>

      {sucesso && <div className="alert alert-success">{sucesso}</div>}
      {erro && <div className="alert alert-error">{erro}</div>}

      <div className="card" style={{ overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Aluno</th>
              <th>Matrícula</th>
              <th>Emitido por</th>
              <th>Data</th>
              <th>Status</th>
              <th style={{ width: 150 }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  Carregando…
                </td>
              </tr>
            )}
            {!carregando && historico.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  Nenhuma {L.docPlural.toLowerCase()} emitida ainda.
                </td>
              </tr>
            )}
            {historico.map((d) => (
              <tr key={d.id}>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {d.codigo_verificacao.slice(0, 13)}…
                </td>
                <td>{d.aluno_nome}</td>
                <td style={{ fontFamily: 'monospace' }}>{d.aluno_matricula}</td>
                <td>{d.emitido_por_nome}{d.emitido_por_codigo ? ` (${d.emitido_por_codigo})` : ''}</td>
                <td>{new Date(d.emitido_em).toLocaleString('pt-BR')}</td>
                <td>
                  <span className="badge badge-ok">Emitida</span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn-ghost btn-sm"
                      onClick={async () => {
                        setErro(null);
                        setSucesso(null);
                        const res = await api.declaracoes.baixar(d.id);
                        if (res.ok && res.data) {
                          setSucesso(`${L.docSingular} baixada em: ${res.data.salvoPath}`);
                          setTimeout(() => setSucesso(null), 5000);
                        } else if (res.error !== 'Operação cancelada') {
                          setErro(res.error ?? 'Erro ao baixar');
                          setTimeout(() => setErro(null), 5000);
                        }
                      }}
                      title="Baixar PDF"
                    >
                      ⬇️ Baixar
                    </button>
                    {podeExcluir && (
                      <button className="btn-danger btn-sm" onClick={() => abrirExclusao(d)}>
                        Excluir
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {seletorAberto && (
        <Modal
          title={semAssinatura ? `Emitir ${L.docSingular} (Sem Assinatura)` : `Emitir ${L.docSingular}`}
          width={620}
          onClose={() => (emitindo ? undefined : (setSeletorAberto(false), setSemAssinatura(false)))}
          footer={
            <>
              <button className="btn-ghost" onClick={() => { setSeletorAberto(false); setSemAssinatura(false); }} disabled={emitindo}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={emitir} disabled={emitindo || !alunoSelecionado}>
                {emitindo ? 'Emitindo…' : semAssinatura ? 'Emitir PDF (SA)' : 'Emitir PDF'}
              </button>
            </>
          }
        >
          <div className="form-row">
            <label>Buscar aluno</label>
            <input
              placeholder="Nome, matrícula, CPF ou curso…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>

          <div
            style={{
              maxHeight: 240,
              overflowY: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 8,
              marginBottom: 12,
            }}
          >
            {alunos.length === 0 && (
              <div style={{ padding: 16, color: 'var(--text-muted)', textAlign: 'center' }}>
                Nenhum aluno encontrado.
              </div>
            )}
            {alunos.map((a) => (
              <div
                key={a.id}
                onClick={() => setAlunoSelecionado(a)}
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: alunoSelecionado?.id === a.id ? 'var(--surface-tint)' : 'transparent',
                }}
              >
                <strong>{a.nome}</strong>{' '}
                <span style={{ color: 'var(--text-muted)' }}>
                  · {a.matricula}
                  {a.curso ? ` · ${a.curso}` : ''}
                </span>
              </div>
            ))}
          </div>

          {alunoSelecionado && (
            <div className="alert alert-success" style={{ margin: 0 }}>
              Selecionado: <strong>{alunoSelecionado.nome}</strong> ({alunoSelecionado.matricula})
            </div>
          )}
        </Modal>
      )}

      {excluirAlvo && (
        <Modal
          title={`Excluir ${L.docSingular}`}
          onClose={() => (excluindo ? undefined : setExcluirAlvo(null))}
          footer={
            <>
              <button className="btn-ghost" onClick={() => setExcluirAlvo(null)} disabled={excluindo}>
                Cancelar
              </button>
              <button
                className="btn-danger"
                onClick={confirmarExclusao}
                disabled={excluindo || !senhaConfirmacao}
              >
                {excluindo ? 'Excluindo…' : 'Excluir'}
              </button>
            </>
          }
        >
          <div className="alert alert-warning">
            Esta ação remove a {L.docPlural.toLowerCase()} <strong>{excluirAlvo.aluno_nome}</strong> ({excluirAlvo.aluno_matricula})
            {' '}e invalida o QR Code de verificação. Não pode ser desfeita.
          </div>
          {erroExcluir && <div className="alert alert-error">{erroExcluir}</div>}
          <div className="form-row">
            <label>Digite a senha master de exclusão</label>
            <input
              type="password"
              autoFocus
              autoComplete="off"
              placeholder="Senha master do administrador"
              value={senhaConfirmacao}
              onChange={(e) => setSenhaConfirmacao(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && senhaConfirmacao && !excluindo) confirmarExclusao();
              }}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
