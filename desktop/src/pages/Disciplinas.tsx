import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Disciplina, DisciplinaInput, Docente } from '../types';
import { Modal } from '../components/Modal';
import { formatarDisciplina } from '../utils/formatar';

const VAZIO: DisciplinaInput = { nome: '', docente_id: null, ch: '' };

export function Disciplinas() {
  const [lista, setLista] = useState<Disciplina[]>([]);
  const [docentes, setDocentes] = useState<Docente[]>([]);
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState<Disciplina | null>(null);
  const [form, setForm] = useState<DisciplinaInput>(VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [excluirId, setExcluirId] = useState<number | null>(null);
  const [excluirSenha, setExcluirSenha] = useState('');
  const [excluirErro, setExcluirErro] = useState<string | null>(null);
  const [masterSenha, setMasterSenha] = useState('');

  async function carregar(termo?: string) {
    setCarregando(true);
    const res = await api.disciplinas.listar(termo);
    if (res.ok && res.data) setLista(res.data);
    setCarregando(false);
  }

  async function carregarDocentes() {
    const res = await api.docentes.listar();
    if (res.ok && res.data) setDocentes(res.data);
  }

  // Busca inicial + debounce (um único useEffect para evitar fetch duplicado no mount).
  // Docentes são imutáveis na sessão — carrega uma única vez.
  useEffect(() => {
    const t = setTimeout(() => carregar(busca), 250);
    return () => clearTimeout(t);
  }, [busca]);

  useEffect(() => {
    carregarDocentes();
  }, []);

  function abrirNovo() {
    setEditando(null);
    setForm(VAZIO);
    setErro(null);
    setModalAberto(true);
  }

  function abrirEdicao(d: Disciplina) {
    setEditando(d);
    setForm({ nome: d.nome, docente_id: d.docente_id, ch: d.ch ?? '' });
    setMasterSenha('');
    setErro(null);
    setModalAberto(true);
  }

  async function salvar() {
    setErro(null);
    if (!form.nome.trim()) {
      setErro('Nome da disciplina é obrigatório');
      return;
    }
    setSalvando(true);
    const res = editando
      ? await api.disciplinas.atualizar(editando.id, form, masterSenha)
      : await api.disciplinas.criar(form);
    setSalvando(false);
    if (res.ok) {
      setModalAberto(false);
      setMasterSenha('');
      setSucesso(editando ? 'Disciplina atualizada.' : 'Disciplina cadastrada.');
      await carregar(busca);
      setTimeout(() => setSucesso(null), 3000);
    } else {
      setErro(res.error ?? 'Erro ao salvar');
    }
  }

  async function confirmarExclusao() {
    if (excluirId == null) return;
    const res = await api.disciplinas.excluir(excluirId, excluirSenha);
    if (res.ok) {
      setExcluirId(null);
      setExcluirSenha('');
      setExcluirErro(null);
      setSucesso('Disciplina excluída.');
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
          <h1 style={{ margin: '0 0 4px', fontSize: 22 }}>Disciplinas</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
            Cadastro de disciplinas, professor e carga horária ({lista.length} registrada{lista.length === 1 ? '' : 's'}).
          </p>
        </div>
        <button className="btn-primary" onClick={abrirNovo}>
          + Adicionar Disciplina
        </button>
      </div>

      {sucesso && <div className="alert alert-success">{sucesso}</div>}

      <div style={{ marginBottom: 14 }}>
        <input
          placeholder="Buscar por disciplina, professor ou CH…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ maxWidth: 380 }}
        />
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Disciplina</th>
              <th>Professor</th>
              <th style={{ width: 120 }}>CH</th>
              <th style={{ width: 200 }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  Carregando…
                </td>
              </tr>
            )}
            {!carregando && lista.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  Nenhuma disciplina encontrada.
                </td>
              </tr>
            )}
            {lista.map((d) => (
              <tr key={d.id}>
                <td style={{ fontWeight: 500 }}>{formatarDisciplina(d.nome)}</td>
                <td>{formatarDisciplina(d.docente_nome || '—')}</td>
                <td style={{ fontFamily: 'monospace' }}>{d.ch || '—'}</td>
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
          title={editando ? 'Editar Disciplina' : 'Adicionar Disciplina'}
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
            <label>Nome da Disciplina *</label>
            <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoFocus />
          </div>
          <div className="form-row">
            <label>Professor</label>
            <select
              value={form.docente_id ?? ''}
              onChange={(e) =>
                setForm({ ...form, docente_id: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">Selecione…</option>
              {docentes.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.nome}
                  {doc.titulacao ? ` — ${doc.titulacao}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Carga Horária (CH)</label>
            <input
              placeholder="Ex.: 60H"
              value={form.ch}
              onChange={(e) => setForm({ ...form, ch: e.target.value })}
            />
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
          title="Excluir Disciplina"
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
          <div className="alert alert-warning">Tem certeza que deseja excluir esta disciplina?</div>
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
