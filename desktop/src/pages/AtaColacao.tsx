import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AtaColacaoConcluinte, AtaColacaoDados } from '../types';
import { Modal } from '../components/Modal';
import { ESTADOS_BR } from './Alunos';

const VAZIO: AtaColacaoDados = {
  aluno_id: 0,
  numero_ata: '',
  data: '',
  horario: '',
  plataforma: '',
  instituicao: '',
  cidade: '',
  estado: '',
  grau: 'Bacharelado',
  modalidade: 'EAD',
  presidente_nome: '',
  presidente_cargo: 'Presidente da Sessão',
  diretor_nome: '',
  diretor_cargo: 'Diretor(a)',
};

const OPCOES_GRAU = ['Bacharelado', 'Licenciatura', 'Tecnólogo', 'Mestrado', 'Doutorado', 'Especialização'];
const OPCOES_MODALIDADE = ['EAD', 'Presencial', 'Híbrido'];

export function AtaColacao() {
  const [lista, setLista] = useState<AtaColacaoConcluinte[]>([]);
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [edicao, setEdicao] = useState<AtaColacaoConcluinte | null>(null);
  const [form, setForm] = useState<AtaColacaoDados>(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erroEdicao, setErroEdicao] = useState<string | null>(null);
  const [gerandoId, setGerandoId] = useState<number | null>(null);

  async function carregar(termo?: string) {
    setCarregando(true);
    const res = await api.ataColacao.listarConcluintes(termo);
    if (res.ok && res.data) setLista(res.data);
    setCarregando(false);
  }

  useEffect(() => {
    const t = setTimeout(() => carregar(busca), 250);
    return () => clearTimeout(t);
  }, [busca]);

  async function abrirEdicao(c: AtaColacaoConcluinte) {
    setErro(null);
    setSucesso(null);
    setEdicao(c);
    setErroEdicao(null);
    const res = await api.ataColacao.obter(c.id);
    const dados = res.data;
    setForm({
      ...VAZIO,
      aluno_id: c.id,
      numero_ata: dados?.numero_ata ?? '',
      data: dados?.data ?? c.data_colacao ?? '',
      horario: dados?.horario ?? '',
      plataforma: dados?.plataforma ?? '',
      instituicao: dados?.instituicao ?? '',
      cidade: dados?.cidade ?? '',
      estado: dados?.estado ?? '',
      grau: dados?.grau ?? 'Bacharelado',
      modalidade: dados?.modalidade ?? 'EAD',
      presidente_nome: dados?.presidente_nome ?? '',
      presidente_cargo: dados?.presidente_cargo ?? 'Presidente da Sessão',
      diretor_nome: dados?.diretor_nome ?? '',
      diretor_cargo: dados?.diretor_cargo ?? 'Diretor(a)',
    });
  }

  async function salvar() {
    if (!edicao) return;
    setSalvando(true);
    setErroEdicao(null);
    const res = await api.ataColacao.salvar(form);
    setSalvando(false);
    if (res.ok) {
      setEdicao(null);
      setSucesso('Dados da ata salvos.');
      await carregar(busca);
      setTimeout(() => setSucesso(null), 3000);
    } else {
      setErroEdicao(res.error ?? 'Erro ao salvar');
    }
  }

  async function gerarPdf(c: AtaColacaoConcluinte) {
    setErro(null);
    setSucesso(null);
    setGerandoId(c.id);
    const res = await api.ataColacao.gerarPdf(c.id);
    setGerandoId(null);
    if (res.ok && res.data) {
      setSucesso(`Ata gerada em: ${res.data.pdfPath}`);
      await carregar(busca);
      setTimeout(() => setSucesso(null), 6000);
    } else {
      setErro(res.error ?? 'Erro ao gerar PDF');
      setTimeout(() => setErro(null), 6000);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Ata de Colação de Grau</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
          Geração de Ata de Colação de Grau Individual — Sessão Online. Apenas alunos com ano de
          conclusão (ou data de colação) preenchido.
        </p>
      </div>

      {sucesso && <div className="alert alert-success">{sucesso}</div>}
      {erro && <div className="alert alert-error">{erro}</div>}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          placeholder="Buscar por nome, matrícula, CPF ou curso…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ maxWidth: 380 }}
        />
        <span style={{ alignSelf: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
          {lista.length} concluinte(s)
        </span>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Matrícula</th>
              <th>Concluinte</th>
              <th>Curso</th>
              <th>Conclusão</th>
              <th>Nº Ata</th>
              <th style={{ width: 210 }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  Carregando…
                </td>
              </tr>
            )}
            {!carregando && lista.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  Nenhum concluinte encontrado. Cadastre o ano de conclusão do aluno na aba Alunos.
                </td>
              </tr>
            )}
            {lista.map((c) => (
              <tr key={c.id}>
                <td style={{ fontFamily: 'monospace' }}>{c.matricula}</td>
                <td>{c.nome}</td>
                <td>{c.curso || '—'}</td>
                <td>{c.data_colacao || c.ano_conclusao || '—'}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {c.numero_ata || '—'}
                  {c.emitido_em && (
                    <span style={{ color: 'var(--success)', marginLeft: 6 }} title={c.emitido_em}>
                      ●
                    </span>
                  )}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn-ghost btn-sm" onClick={() => abrirEdicao(c)}>
                      Editar
                    </button>
                    <button
                      className="btn-primary btn-sm"
                      onClick={() => gerarPdf(c)}
                      disabled={gerandoId === c.id}
                    >
                      {gerandoId === c.id ? 'Gerando…' : 'Gerar PDF'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edicao && (
        <Modal
          title={`Ata de Colação — ${edicao.nome}`}
          width={820}
          onClose={() => (salvando ? undefined : setEdicao(null))}
          footer={
            <>
              <button className="btn-ghost" onClick={() => setEdicao(null)} disabled={salvando}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={salvar} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </>
          }
        >
          {erroEdicao && <div className="alert alert-error">{erroEdicao}</div>}

          <div style={{ marginBottom: 10, padding: 10, background: 'var(--surface-tint)', borderRadius: 6, fontSize: 13 }}>
            <strong>{edicao.nome}</strong> · Matrícula {edicao.matricula}
            {edicao.curso ? ` · ${edicao.curso}` : ''}
            {edicao.cpf ? ` · CPF ${edicao.cpf}` : ''}
          </div>

          <h3 style={{ fontSize: 13, margin: '14px 0 8px', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
            Sessão
          </h3>
          <div className="form-grid">
            <div className="form-row">
              <label>Número da Ata</label>
              <input
                value={form.numero_ata}
                onChange={(e) => setForm({ ...form, numero_ata: e.target.value })}
                placeholder="Ex.: 001/2026"
              />
            </div>
            <div className="form-row">
              <label>Data da Sessão</label>
              <input
                type="date"
                value={form.data}
                onChange={(e) => setForm({ ...form, data: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Horário</label>
              <input
                value={form.horario}
                onChange={(e) => setForm({ ...form, horario: e.target.value })}
                placeholder="Ex.: 14h30"
              />
            </div>
            <div className="form-row">
              <label>Plataforma Utilizada</label>
              <input
                value={form.plataforma}
                onChange={(e) => setForm({ ...form, plataforma: e.target.value })}
                placeholder="Ex.: Google Meet / Zoom / Teams"
              />
            </div>
          </div>

          <h3 style={{ fontSize: 13, margin: '14px 0 8px', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
            Instituição e Localidade
          </h3>
          <div className="form-grid">
            <div className="full form-row">
              <label>Instituição</label>
              <input
                value={form.instituicao}
                onChange={(e) => setForm({ ...form, instituicao: e.target.value })}
                placeholder="Nome da instituição de ensino"
              />
            </div>
            <div className="form-row">
              <label>Cidade</label>
              <input
                value={form.cidade}
                onChange={(e) => setForm({ ...form, cidade: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Estado (UF)</label>
              <select value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })}>
                <option value="">—</option>
                {ESTADOS_BR.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Grau</label>
              <select value={form.grau} onChange={(e) => setForm({ ...form, grau: e.target.value })}>
                {OPCOES_GRAU.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Modalidade</label>
              <select
                value={form.modalidade}
                onChange={(e) => setForm({ ...form, modalidade: e.target.value })}
              >
                {OPCOES_MODALIDADE.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <h3 style={{ fontSize: 13, margin: '14px 0 8px', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
            Composição da Mesa
          </h3>
          <div className="form-grid">
            <div className="form-row">
              <label>Presidente da Sessão — Nome</label>
              <input
                value={form.presidente_nome}
                onChange={(e) => setForm({ ...form, presidente_nome: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Presidente da Sessão — Cargo</label>
              <input
                value={form.presidente_cargo}
                onChange={(e) => setForm({ ...form, presidente_cargo: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Diretor(a) — Nome</label>
              <input
                value={form.diretor_nome}
                onChange={(e) => setForm({ ...form, diretor_nome: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Diretor(a) — Cargo</label>
              <input
                value={form.diretor_cargo}
                onChange={(e) => setForm({ ...form, diretor_cargo: e.target.value })}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
