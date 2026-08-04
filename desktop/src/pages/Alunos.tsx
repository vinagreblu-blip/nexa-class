import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Aluno, AlunoInput } from '../types';
import { Modal, ConfirmDialog } from '../components/Modal';
import { DocumentosAluno } from '../components/DocumentosAluno';
import { mascararCPF } from '../utils';

export const FACULDADES = ['Hélio Rocha', 'FACIIP', 'FATECE', 'FACEI', '2 de Julho'] as const;
export const ESTADOS_BR = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;
export const NACIONALIDADES = [
  'Brasileiro(a)',
  'Português(a)',
  'Argentino(a)',
  'Boliviano(a)',
  'Chileno(a)',
  'Colombiano(a)',
  'Cubano(a)',
  'Equatoriano(a)',
  'Paraguaio(a)',
  'Peruano(a)',
  'Uruguaio(a)',
  'Venezuelano(a)',
  'Haitiano(a)',
  'Espanhol(a)',
  'Italiano(a)',
  'Francês(a)',
  'Alemão(a)',
  'Americano(a)',
  'Angolano(a)',
  'Cabo-verdiano(a)',
  'Moçambicano(a)',
  'Outra',
] as const;
export const SEMESTRES: string[] = (() => {
  const lista: string[] = [];
  for (let ano = 1990; ano <= 2050; ano++) {
    lista.push(`${ano}.1`);
    lista.push(`${ano}.2`);
  }
  return lista;
})();

export const CURSOS_POR_FACULDADE: Record<string, readonly string[]> = {
  'Hélio Rocha': [
    'Administração',
    'Comunicação Social (Publicidade e Propaganda)',
    'Engenharia Civil',
    'Engenharia Elétrica',
    'Engenharia de Produção',
    'Fisioterapia',
    'Serviço Social',
    'Sistema de Informação',
    'Turismo',
  ],
  FACIIP: [
    'Administração',
    'Administração Hospitalar',
    'Comunicação Social (Relações Públicas)',
    'Ciências Contábeis',
    'Engenharia de Produção Mecânica',
    'Jornalismo',
    'Pedagogia',
    'Turismo e Hotelaria',
  ],
  FATECE: ['Administração', 'Pedagogia', 'Teologia'],
  FACEI: ['Administração'],
  '2 de Julho': ['Direito', 'Jornalismo'],
};

const VAZIO: AlunoInput = {
  matricula: '',
  nome: '',
  cpf: '',
  rg: '',
  nacionalidade: '',
  naturalidade: '',
  cidade: '',
  sexo: '',
  orgao_emissor: '',
  turno: '',
  forma_ingresso: '',
  data_vestibular: '',
  data_colacao: '',
  email: '',
  telefone: '',
  curso: '',
  faculdade: '',
  ano_ingresso: '',
  ano_conclusao: '',
  data_nascimento: '',
};

function gerarMatriculaCliente(rg: string, anoIngresso: string): string {
  const todosDigitos = (rg || '').replace(/\D/g, '');
  const numeroBase = todosDigitos.slice(0, -1);
  const ultimos5 = numeroBase.slice(-5);
  const ano = (anoIngresso || '').split('.')[0] || String(new Date().getFullYear());
  return `${ano}${ultimos5}`;
}

export function Alunos() {
  const [lista, setLista] = useState<Aluno[]>([]);
  const [busca, setBusca] = useState('');
  const [faculdadeFiltro, setFaculdadeFiltro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState<Aluno | null>(null);
  const [form, setForm] = useState<AlunoInput>(VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [excluirId, setExcluirId] = useState<number | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [extraindoIA, setExtraindoIA] = useState(false);
  const [matriculaEditada, setMatriculaEditada] = useState(false);

  async function carregar(termo?: string) {
    setCarregando(true);
    const res = await api.alunos.listar(termo);
    if (res.ok && res.data) setLista(res.data);
    setCarregando(false);
  }

  // Busca inicial + debounce (um único useEffect para evitar fetch duplicado no mount).
  useEffect(() => {
    const t = setTimeout(() => carregar(busca), 250);
    return () => clearTimeout(t);
  }, [busca]);

  async function cadastroComIA() {
    setErro(null);
    setExtraindoIA(true);
    try {
      const res = await api.extracao.extrairDadosDocumento();
      if (res.ok && res.data) {
        const d = res.data;
        setForm((f) => ({
          ...f,
          nome: d.nome ?? f.nome,
          cpf: d.cpf ?? f.cpf,
          rg: d.rg ?? f.rg,
          orgao_emissor: d.orgaoEmissor ?? f.orgao_emissor,
          naturalidade: d.naturalidade ?? f.naturalidade,
          nacionalidade: d.nacionalidade ?? f.nacionalidade,
          data_nascimento: d.dataNascimento ?? f.data_nascimento,
          sexo: d.sexo ?? f.sexo,
        }));
        const campos = [
          d.nome && 'Nome',
          d.cpf && 'CPF',
          d.rg && 'RG',
          d.orgaoEmissor && 'Órgão Emissor',
          d.naturalidade && 'Naturalidade',
          d.nacionalidade && 'Nacionalidade',
          d.dataNascimento && 'Data de Nascimento',
          d.sexo && 'Sexo',
        ].filter(Boolean);
        if (campos.length > 0) {
          setSucesso(campos.join(', ') + ' preenchidos automaticamente.');
        } else {
          setSucesso('Documento lido, mas não foi possível identificar os campos. Preencha manualmente.');
        }
        setTimeout(() => setSucesso(null), 6000);
      } else if (res.error && res.error !== 'Nenhum arquivo selecionado') {
        setErro(res.error);
      }
    } catch (e: any) {
      setErro('Erro ao extrair dados: ' + (e?.message ?? ''));
    }
    setExtraindoIA(false);
  }
  function abrirNovo() {
    setEditando(null);
    setForm(VAZIO);
    setErro(null);
    setMatriculaEditada(false);
    setModalAberto(true);
  }

  function abrirEdicao(a: Aluno) {
    setEditando(a);
    setForm({
      matricula: a.matricula,
      nome: a.nome,
      cpf: a.cpf ?? '',
      rg: a.rg ?? '',
      nacionalidade: a.nacionalidade ?? '',
      naturalidade: a.naturalidade ?? '',
      cidade: a.cidade ?? '',
      sexo: a.sexo ?? '',
      orgao_emissor: a.orgao_emissor ?? '',
      turno: a.turno ?? '',
      forma_ingresso: a.forma_ingresso ?? '',
      data_vestibular: a.data_vestibular ?? '',
      data_colacao: a.data_colacao ?? '',
      email: a.email ?? '',
      telefone: a.telefone ?? '',
      curso: a.curso ?? '',
      faculdade: a.faculdade ?? '',
      ano_ingresso: a.ano_ingresso ?? '',
      ano_conclusao: a.ano_conclusao ?? '',
      data_nascimento: a.data_nascimento ?? '',
    });
    setErro(null);
    setMatriculaEditada(true);
    setModalAberto(true);
  }

  useEffect(() => {
    if (editando || matriculaEditada) return;
    setForm((f) => {
        if (f.rg) {
          return { ...f, matricula: gerarMatriculaCliente(f.rg, f.ano_ingresso ?? '') };
        }
      return f.matricula ? { ...f, matricula: '' } : f;
    });
  }, [form.rg, form.ano_ingresso, editando, matriculaEditada]);

  async function salvar() {
    setErro(null);
    setSalvando(true);
    const res = editando
      ? await api.alunos.atualizar(editando.id, form)
      : await api.alunos.criar(form);
    setSalvando(false);
    if (res.ok) {
      setModalAberto(false);
      setSucesso(editando ? 'Aluno atualizado.' : 'Aluno cadastrado.');
      await carregar(busca);
      setTimeout(() => setSucesso(null), 3000);
    } else {
      setErro(res.error ?? 'Erro ao salvar');
    }
  }

  async function confirmarExclusao() {
    if (excluirId == null) return;
    const res = await api.alunos.excluir(excluirId);
    setExcluirId(null);
    if (res.ok) {
      setSucesso('Aluno excluído.');
      await carregar(busca);
      setTimeout(() => setSucesso(null), 3000);
    } else {
      setErro(res.error ?? 'Erro ao excluir');
      setTimeout(() => setErro(null), 5000);
    }
  }

  const cursosDaFaculdade = form.faculdade ? CURSOS_POR_FACULDADE[form.faculdade] ?? [] : [];

  const listaFiltrada = lista.filter((a) => {
    if (!faculdadeFiltro) return true;
    return a.faculdade === faculdadeFiltro;
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Alunos</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
            Cadastro, edição e exclusão de alunos.
          </p>
        </div>
        <button className="btn-primary" onClick={abrirNovo}>
          + Novo Aluno
        </button>
      </div>

      {sucesso && <div className="alert alert-success">{sucesso}</div>}
      {erro && !modalAberto && <div className="alert alert-error">{erro}</div>}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          placeholder="Buscar por nome, matrícula, CPF ou curso…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ maxWidth: 380 }}
        />
        <select
          value={faculdadeFiltro}
          onChange={(e) => setFaculdadeFiltro(e.target.value)}
          style={{ maxWidth: 200 }}
        >
          <option value="">Todas as faculdades</option>
          {FACULDADES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <span style={{ alignSelf: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
          {listaFiltrada.length} aluno(s)
        </span>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Matrícula</th>
              <th>Nome</th>
              <th>Curso</th>
              <th>E-mail</th>
              <th style={{ width: 200 }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  Carregando…
                </td>
              </tr>
            )}
            {!carregando && listaFiltrada.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  Nenhum aluno encontrado.
                </td>
              </tr>
            )}
            {listaFiltrada.map((a) => (
              <tr key={a.id}>
                <td style={{ fontFamily: 'monospace' }}>{a.matricula}</td>
                <td>{a.nome}</td>
                <td>{a.curso || '—'}</td>
                <td>{a.email || '—'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn-ghost btn-sm" onClick={() => abrirEdicao(a)}>
                      Editar
                    </button>
                    <button className="btn-danger btn-sm" onClick={() => setExcluirId(a.id)}>
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
          title={editando ? 'Editar Aluno' : 'Novo Aluno'}
          width={820}
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
          {sucesso && <div className="alert alert-success">{sucesso}</div>}
          {!editando && (
            <button
              className="btn-ghost"
              onClick={cadastroComIA}
              disabled={extraindoIA || salvando}
              style={{ marginBottom: 14, width: '100%', border: '1px solid var(--btn-bg)', color: 'var(--btn-bg)' }}
            >
              {extraindoIA ? '⏳ Lendo documento…' : '🤖 Cadastro com IA (RG / CNH)'}
            </button>
          )}
          <div className="form-grid">
            <div className="full form-row">
              <label>Nome Completo *</label>
              <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoFocus />
            </div>
            <div className="form-row">
              <label>CPF *</label>
              <input
                value={form.cpf}
                onChange={(e) => setForm({ ...form, cpf: mascararCPF(e.target.value) })}
                placeholder="000.000.000-00"
                maxLength={14}
              />
            </div>
            <div className="form-row">
              <label>RG *</label>
              <input value={form.rg} onChange={(e) => setForm({ ...form, rg: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Órgão Emissor do RG</label>
              <input
                value={form.orgao_emissor}
                onChange={(e) => setForm({ ...form, orgao_emissor: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Matrícula {editando ? '' : '(gerada automaticamente, editável)'}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={form.matricula}
                  onChange={(e) => {
                    setMatriculaEditada(true);
                    setForm({ ...form, matricula: e.target.value });
                  }}
                  placeholder={!editando ? 'Ano de ingresso + 5 dígitos do RG' : ''}
                  style={{
                    fontFamily: 'monospace',
                    color: form.matricula ? 'var(--text)' : 'var(--text-muted)',
                  }}
                />
                {!editando && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={!form.rg}
                    onClick={() => {
                      setMatriculaEditada(false);
                      setForm((f) => ({
                        ...f,
                        matricula: gerarMatriculaCliente(f.rg || '', f.ano_ingresso || ''),
                      }));
                    }}
                    title="Gerar nova matrícula"
                  >
                    Gerar
                  </button>
                )}
              </div>
            </div>
            <div className="form-row">
              <label>Nacionalidade</label>
              <select
                value={form.nacionalidade}
                onChange={(e) => setForm({ ...form, nacionalidade: e.target.value })}
              >
                <option value="">Selecione…</option>
                {(NACIONALIDADES as readonly string[]).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Naturalidade</label>
              <select
                value={form.naturalidade}
                onChange={(e) => setForm({ ...form, naturalidade: e.target.value })}
              >
                <option value="">Selecione…</option>
                {ESTADOS_BR.map((uf) => (
                  <option key={uf} value={uf}>{uf}</option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Cidade</label>
              <input value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Sexo</label>
              <select value={form.sexo} onChange={(e) => setForm({ ...form, sexo: e.target.value })}>
                <option value="">Selecione…</option>
                <option value="Masculino">Masculino</option>
                <option value="Feminino">Feminino</option>
                <option value="Outro">Outro</option>
              </select>
            </div>
            <div className="form-row">
              <label>Data de Nascimento</label>
              <input
                type="date"
                value={form.data_nascimento}
                onChange={(e) => setForm({ ...form, data_nascimento: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>E-mail</label>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Telefone</label>
              <input
                value={form.telefone}
                onChange={(e) => setForm({ ...form, telefone: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Faculdade</label>
              <select
                value={form.faculdade}
                onChange={(e) => setForm({ ...form, faculdade: e.target.value, curso: '' })}
              >
                <option value="">Selecione…</option>
                {FACULDADES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Curso</label>
              <select
                value={form.curso}
                onChange={(e) => setForm({ ...form, curso: e.target.value })}
                disabled={!form.faculdade}
              >
                <option value="">
                  {form.faculdade ? 'Selecione…' : 'Selecione a faculdade primeiro'}
                </option>
                {cursosDaFaculdade.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                {form.curso && !cursosDaFaculdade.includes(form.curso) && (
                  <option value={form.curso}>{form.curso}</option>
                )}
              </select>
            </div>
            <div className="form-row">
              <label>Turno</label>
              <select value={form.turno} onChange={(e) => setForm({ ...form, turno: e.target.value })}>
                <option value="">Selecione…</option>
                <option value="Matutino">Matutino</option>
                <option value="Vespertino">Vespertino</option>
                <option value="Noturno">Noturno</option>
                <option value="Integral">Integral</option>
              </select>
            </div>
            <div className="form-row">
              <label>Ano do Vestibular *</label>
              <select
                value={form.ano_ingresso}
                onChange={(e) => setForm({ ...form, ano_ingresso: e.target.value })}
              >
                <option value="">Selecione…</option>
                {SEMESTRES.map((sem) => (
                  <option key={sem} value={sem}>
                    {sem}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Data de Formação</label>
              <input
                type="date"
                value={form.ano_conclusao && form.ano_conclusao !== 'Cursando' ? form.ano_conclusao : ''}
                onChange={(e) => setForm({ ...form, ano_conclusao: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Data da Colação de Grau</label>
              <input
                type="date"
                value={form.data_colacao}
                onChange={(e) => setForm({ ...form, data_colacao: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Formas de Ingresso</label>
              <select
                value={form.forma_ingresso}
                onChange={(e) => setForm({ ...form, forma_ingresso: e.target.value })}
              >
                <option value="">Selecione…</option>
                <option value="ENEM">ENEM</option>
                <option value="Vestibular">Vestibular</option>
              </select>
            </div>
          </div>

          {editando ? (
            <DocumentosAluno alunoId={editando.id} />
          ) : (
            <div
              style={{
                marginTop: 18,
                padding: 14,
                border: '1px dashed var(--border)',
                borderRadius: 8,
                color: 'var(--text-muted)',
                fontSize: 13,
                textAlign: 'center',
              }}
            >
              Salve o aluno para poder anexar PDFs e converter em XML.
            </div>
          )}
        </Modal>
      )}

      {excluirId != null && (
        <ConfirmDialog
          title="Excluir Aluno"
          message="Tem certeza que deseja excluir este aluno? Esta ação não pode ser desfeita."
          confirmLabel="Excluir"
          onConfirm={confirmarExclusao}
          onCancel={() => setExcluirId(null)}
        />
      )}
    </div>
  );
}
