import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Docente, DocenteInput } from '../types';
import { Modal } from '../components/Modal';
import { formatarDisciplina } from '../utils/formatar';

const TITULACOES = ['DOUTOR', 'DOUTORA', 'MESTRADO', 'MESTRADO/DOUTORADO', 'ESPECIALISTA', 'GRADUADO'] as const;

const VAZIO: DocenteInput = { nome: '', titulacao: '' };

export function Docentes() {
  const [lista, setLista] = useState<Docente[]>([]);
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState<Docente | null>(null);
  const [form, setForm] = useState<DocenteInput>(VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [excluirId, setExcluirId] = useState<number | null>(null);
  const [excluirSenha, setExcluirSenha] = useState('');
  const [excluirErro, setExcluirErro] = useState<string | null>(null);
  const [masterSenha, setMasterSenha] = useState('');

  async function carregar(termo?: string) {
    setCarregando(true);
    const res = await api.docentes.listar(termo);
    if (res.ok && res.data) setLista(res.data);
    setCarregando(false);
  }

  useEffect(() => {
    const t = setTimeout(() => carregar(busca), 250);
    return () => clearTimeout(t);
  }, [busca]);

  useEffect(() => {
    carregar();
  }, []);

  function abrirNovo() {
    setEditando(null);
    setForm(VAZIO);
    setErro(null);
    setModalAberto(true);
  }

  function abrirEdicao(d: Docente) {
    setEditando(d);
    setForm({ nome: d.nome, titulacao: d.titulacao ?? '' });
    setMasterSenha('');
    setErro(null);
    setModalAberto(true);
  }

  async function salvar() {
    setErro(null);
    if (!form.nome.trim()) {
      setErro('Nome é obrigatório');
      return;
    }
    setSalvando(true);
    const res = editando
      ? await api.docentes.atualizar(editando.id, form, masterSenha)
      : await api.docentes.criar(form);
    setSalvando(false);
    if (res.ok) {
      setModalAberto(false);
      setMasterSenha('');
      setSucesso(editando ? 'Docente atualizado.' : 'Docente cadastrado.');
      await carregar(busca);
      setTimeout(() => setSucesso(null), 3000);
    } else {
      setErro(res.error ?? 'Erro ao salvar');
    }
  }

  async function confirmarExclusao() {
    if (excluirId == null) return;
    const res = await api.docentes.excluir(excluirId, excluirSenha);
    if (res.ok) {
      setExcluirId(null);
      setExcluirSenha('');
      setExcluirErro(null);
      setSucesso('Docente excluído.');
      await carregar(busca);
      setTimeout(() => setSucesso(null), 3000);
    } else {
      setExcluirErro(res.error ?? 'Erro ao excluir');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 22 }}>Docentes</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
            Cadastro de docentes e titulações ({lista.length} registrado{lista.length === 1 ? '' : 's'}).
          </p>
        </div>
        <button className="btn-primary" onClick={abrirNovo}>
          + Adicionar Docente
        </button>
      </div>

      {sucesso && <div className="alert alert-success">{sucesso}</div>}

      <div style={{ marginBottom: 14 }}>
        <input
          placeholder="Buscar por nome ou titulação…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ maxWidth: 380 }}
        />
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Titulação</th>
              <th style={{ width: 200 }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr>
                <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  Carregando…
                </td>
              </tr>
            )}
            {!carregando && lista.length === 0 && (
              <tr>
                <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  Nenhum docente encontrado.
                </td>
              </tr>
            )}
            {lista.map((d) => (
              <tr key={d.id}>
                <td style={{ fontWeight: 500 }}>{formatarDisciplina(d.nome)}</td>
                <td>
                  {d.titulacao ? (
                    <span className="badge badge-admin">{d.titulacao}</span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                  )}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn-ghost btn-sm" onClick={() => abrirEdicao(d)}>
                      Editar
                    </button>
                    <button className="btn-danger btn-sm" onClick={() => setExcluirId(d.id)}>
                      Excluir
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalAberto && (
        <Modal
          title={editando ? 'Editar Docente' : 'Adicionar Docente'}
          onClose={() => setModalAberto(false)}
          footer={
            <>
              <button className="btn-ghost" onClick={() => setModalAberto(false)} disabled={salvando}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={salvar} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </>
          }
        >
          {erro && <div className="alert alert-error">{erro}</div>}
          <div className="form-row">
            <label>Nome *</label>
            <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoFocus />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Titulação</label>
            <select value={form.titulacao} onChange={(e) => setForm({ ...form, titulacao: e.target.value })}>
              <option value="">Selecione…</option>
              {TITULACOES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {editando && (
            <div className="form-row" style={{ marginBottom: 0, marginTop: 14 }}>
              <label>Senha master (obrigatória para editar) *</label>
              <input
                type="password"
                value={masterSenha}
                onChange={(e) => setMasterSenha(e.target.value)}
                placeholder="Senha do administrador"
                autoComplete="off"
              />
            </div>
          )}
        </Modal>
      )}

      {excluirId != null && (
        <Modal
          title="Excluir Docente"
          onClose={() => { setExcluirId(null); setExcluirSenha(''); setExcluirErro(null); }}
          footer={
            <>
              <button className="btn-ghost" onClick={() => { setExcluirId(null); setExcluirSenha(''); setExcluirErro(null); }}>
                Cancelar
              </button>
              <button className="btn-danger" onClick={confirmarExclusao} disabled={!excluirSenha}>
                Excluir
              </button>
            </>
          }
        >
          <div className="alert alert-warning">Tem certeza que deseja excluir este docente?</div>
          {excluirErro && <div className="alert alert-error">{excluirErro}</div>}
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Senha master *</label>
            <input
              type="password"
              autoFocus
              autoComplete="off"
              value={excluirSenha}
              onChange={(e) => setExcluirSenha(e.target.value)}
              placeholder="Senha do administrador"
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
