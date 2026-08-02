import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import type { Aluno, DiplomaRow } from '../types';
import { Modal } from '../components/Modal';

export function Diploma() {
  const { usuario } = useAuth();
  const podeExcluir = usuario?.username === 'admin';
  const [lista, setLista] = useState<DiplomaRow[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [alunos, setAlunos] = useState<Aluno[]>([]);
  const [seletorAberto, setSeletorAberto] = useState(false);
  const [alunoSelecionado, setAlunoSelecionado] = useState<Aluno | null>(null);
  const [emitindo, setEmitindo] = useState(false);
  const [semAssinatura, setSemAssinatura] = useState(false);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [excluirAlvo, setExcluirAlvo] = useState<DiplomaRow | null>(null);
  const [senhaConfirmacao, setSenhaConfirmacao] = useState('');
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  async function carregar() {
    setCarregando(true);
    const res = await api.diplomas.listar();
    if (res.ok && res.data) setLista(res.data);
    setCarregando(false);
  }

  async function carregarAlunos() {
    const res = await api.alunos.listar(busca);
    if (res.ok && res.data) setAlunos(res.data);
  }

  useEffect(() => { carregar(); }, []);

  useEffect(() => {
    if (!seletorAberto) return;
    const t = setTimeout(() => { carregarAlunos(); }, 200);
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
    const res = await api.diplomas.emitir(alunoSelecionado.id, semAssinatura);
    setEmitindo(false);
    if (res.ok && res.data) {
      setSeletorAberto(false);
      setSemAssinatura(false);
      setSucesso(`Diploma gerado em: ${(res.data as any).pdfPath}`);
      await carregar();
    } else {
      setErro(res.error ?? 'Erro ao emitir diploma');
    }
  }

  async function baixar(d: DiplomaRow) {
    const res = await api.diplomas.baixar(d.id);
    if (res.ok && res.data) {
      setSucesso(`Salvo em: ${res.data.salvoPath}`);
    } else {
      setErro(res.error ?? 'Erro ao baixar');
    }
  }

  function abrirExclusao(d: DiplomaRow) {
    setExcluirAlvo(d);
    setSenhaConfirmacao('');
    setErroExcluir(null);
  }

  async function confirmarExclusao() {
    if (!excluirAlvo) return;
    setExcluindo(true);
    setErroExcluir(null);
    const res = await api.diplomas.excluir(excluirAlvo.id, senhaConfirmacao);
    setExcluindo(false);
    if (res.ok) {
      setExcluirAlvo(null);
      setSucesso('Diploma excluído.');
      await carregar();
      setTimeout(() => setSucesso(null), 4000);
    } else {
      setErroExcluir(res.error ?? 'Erro ao excluir');
    }
  }

  const filtrados = lista.filter(
    (d) =>
      !busca ||
      d.aluno_nome?.toLowerCase().includes(busca.toLowerCase()) ||
      d.aluno_matricula?.toLowerCase().includes(busca.toLowerCase())
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 22 }}>Diplomas</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
            Emissão e gestão de diplomas de conclusão.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-primary" onClick={() => { setSemAssinatura(false); abrirSeletor(); }}>
            + Emitir Diploma
          </button>
          <button className="btn-ghost" onClick={() => { setSemAssinatura(true); abrirSeletor(); }}>
            + Emitir Diploma (SA)
          </button>
        </div>
      </div>

      {sucesso && <div className="alert alert-success">{sucesso}</div>}
      {erro && <div className="alert alert-error">{erro}</div>}

      <div className="card" style={{ overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Aluno</th>
              <th>Matrícula</th>
              <th>Emitido por</th>
              <th>Data</th>
              <th style={{ width: 150 }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                  {carregando ? 'Carregando…' : 'Nenhum diploma emitido ainda.'}
                </td>
              </tr>
            )}
            {filtrados.map((d) => (
              <tr key={d.id}>
                <td>{d.aluno_nome}</td>
                <td>{d.aluno_matricula}</td>
                <td>{d.emitido_por_nome}</td>
                <td>{new Date(d.emitido_em).toLocaleDateString('pt-BR')}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => baixar(d)}>
                    Baixar
                  </button>
                  {podeExcluir && (
                    <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12, color: '#dc2626' }} onClick={() => abrirExclusao(d)}>
                      Excluir
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {seletorAberto && (
        <Modal
          title={semAssinatura ? 'Emitir Diploma (Sem Assinatura)' : 'Emitir Diploma'}
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
          <div style={{ maxHeight: 300, overflow: 'auto', marginTop: 8, border: '1px solid var(--border)', borderRadius: 6 }}>
            {alunos.map((a) => (
              <div
                key={a.id}
                onClick={() => setAlunoSelecionado(a)}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border)',
                  background: alunoSelecionado?.id === a.id ? 'var(--surface-tint)' : 'transparent',
                }}
              >
                <strong>{a.nome}</strong>
                <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 12 }}>
                  {a.matricula} — {a.curso || 'Sem curso'}
                </span>
              </div>
            ))}
            {alunos.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>Digite para buscar…</div>
            )}
          </div>
          {alunoSelecionado && (
            <div style={{ marginTop: 12, padding: 8, background: 'var(--surface-tint)', borderRadius: 6, fontSize: 13 }}>
              Selecionado: <strong>{alunoSelecionado.nome}</strong> ({alunoSelecionado.matricula})
            </div>
          )}
        </Modal>
      )}

      {excluirAlvo && (
        <Modal
          title="Confirmar exclusão"
          width={440}
          onClose={() => !excluindo && setExcluirAlvo(null)}
          footer={
            <>
              <button className="btn-ghost" onClick={() => setExcluirAlvo(null)} disabled={excluindo}>Cancelar</button>
              <button className="btn-primary" style={{ background: '#dc2626' }} onClick={confirmarExclusao} disabled={excluindo}>
                {excluindo ? 'Excluindo…' : 'Excluir'}
              </button>
            </>
          }
        >
          <p style={{ marginBottom: 12 }}>
            Excluir o diploma de <strong>{excluirAlvo.aluno_nome}</strong> ({excluirAlvo.aluno_matricula})?
          </p>
          <input
            type="password"
            placeholder="Senha de exclusão"
            value={senhaConfirmacao}
            onChange={(e) => setSenhaConfirmacao(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && confirmarExclusao()}
          />
          {erroExcluir && <div className="alert alert-error" style={{ marginTop: 8 }}>{erroExcluir}</div>}
        </Modal>
      )}
    </div>
  );
}
