import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Aluno, DeclaracaoRow, HistoricoDisciplina, HistoricoDisciplinaInput } from '../types';
import { FACULDADES, SEMESTRES } from './Alunos';
import { formatarDisciplina } from '../utils/formatar';
import { Modal, ConfirmDialog } from '../components/Modal';
import { ModalSenhaCertificado } from '../components/ModalSenhaCertificado';

const TITULACOES = ['DOUTOR', 'DOUTORA', 'MESTRADO', 'MESTRADO/DOUTORADO', 'ESPECIALISTA', 'GRADUADO'] as const;
const STATUS_DISC = ['AP', 'REP', 'CUMP', 'MAT', 'TRANC'] as const;

const DISC_VAZIA: HistoricoDisciplinaInput = {
  periodo: '',
  disciplina: '',
  docente: '',
  titulacao: '',
  ch: '',
  nota: '',
  ft: '',
  status: 'AP',
};

export function Historicos() {
  const [lista, setLista] = useState<Aluno[]>([]);
  const [busca, setBusca] = useState('');
  const [faculdadeFiltro, setFaculdadeFiltro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [selecionado, setSelected] = useState<Aluno | null>(null);

  async function carregar() {
    setCarregando(true);
    const res = await api.alunos.listar();
    if (res.ok && res.data) setLista(res.data);
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  const filtrados = lista.filter((a) => {
    const matchBusca =
      !busca.trim() ||
      `${a.nome} ${a.matricula} ${a.curso ?? ''}`.toLowerCase().includes(busca.trim().toLowerCase());
    const matchFaculdade = !faculdadeFiltro || a.faculdade === faculdadeFiltro;
    return matchBusca && matchFaculdade;
  });

  const totalCursando = filtrados.filter((a) => a.ano_conclusao === 'Cursando').length;
  const totalConcluido = filtrados.filter((a) => a.ano_conclusao && a.ano_conclusao !== 'Cursando').length;

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22 }}>Histórico Acadêmico</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
          Histórico acadêmico completo: disciplinas, notas e emissão de PDF.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          placeholder="Buscar por nome, matrícula ou curso…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ maxWidth: 360 }}
        />
        <select value={faculdadeFiltro} onChange={(e) => setFaculdadeFiltro(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">Todas as faculdades</option>
          {FACULDADES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center', fontSize: 13 }}>
          <strong>{filtrados.length}</strong> aluno(s)
          <span className="badge badge-pendente">Cursando: {totalCursando}</span>
          <span className="badge badge-ok">Concluído: {totalConcluido}</span>
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Matrícula</th>
              <th>Nome</th>
              <th>Faculdade</th>
              <th>Curso</th>
              <th>Ingresso</th>
              <th>Conclusão</th>
              <th>Status</th>
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
            {!carregando && filtrados.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  Nenhum aluno encontrado.
                </td>
              </tr>
            )}
            {filtrados.map((a) => (
              <tr key={a.id} style={{ cursor: 'pointer' }} title="Clique para gerenciar o histórico" onClick={() => setSelected(a)}>
                <td style={{ fontFamily: 'monospace' }}>{a.matricula}</td>
                <td>{a.nome}</td>
                <td>{a.faculdade || '—'}</td>
                <td>{a.curso || '—'}</td>
                <td>{a.ano_ingresso || '—'}</td>
                <td>{a.ano_conclusao || '—'}</td>
                <td>
                  {a.ano_conclusao === 'Cursando' ? (
                    <span className="badge badge-pendente">Cursando</span>
                  ) : a.ano_conclusao ? (
                    <span className="badge badge-ok">Concluído</span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selecionado && <ModalHistorico aluno={selecionado} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ModalHistorico({ aluno, onClose }: { aluno: Aluno; onClose: () => void }) {
  const [disciplinas, setDisciplinas] = useState<HistoricoDisciplina[]>([]);
  const [carregandoDisc, setCarregandoDisc] = useState(true);
  const [form, setForm] = useState<HistoricoDisciplinaInput>(DISC_VAZIA);
  const [editId, setEditId] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [gerandoXml, setGerandoXml] = useState(false);
  const [modalSenha, setModalSenha] = useState<'pdf' | 'xml' | null>(null);
  const [excluirId, setExcluirId] = useState<number | null>(null);
  const [declaracoes, setDeclaracoes] = useState<DeclaracaoRow[]>([]);
  const formRef = useRef<HTMLDivElement>(null);

  async function carregarDisc() {
    setCarregandoDisc(true);
    const res = await api.historico.listar(aluno.id);
    if (res.ok && res.data) setDisciplinas(res.data);
    setCarregandoDisc(false);
  }

  useEffect(() => {
    carregarDisc();
    api.declaracoes.listar(aluno.id).then((res) => res.ok && res.data && setDeclaracoes(res.data));
  }, [aluno.id]);

  function resetForm() {
    setForm(DISC_VAZIA);
    setEditId(null);
    setErro(null);
  }

  async function salvarDisc() {
    setErro(null);
    if (!form.periodo || !form.disciplina.trim()) {
      setErro('Período e Disciplina são obrigatórios');
      return;
    }
    setSalvando(true);
    const res =
      editId != null ? await api.historico.atualizar(editId, form) : await api.historico.criar(aluno.id, form);
    setSalvando(false);
    if (res.ok) {
      resetForm();
      await carregarDisc();
    } else {
      setErro(res.error ?? 'Erro ao salvar disciplina');
    }
  }

  function editar(d: HistoricoDisciplina) {
    setEditId(d.id);
    setForm({
      periodo: d.periodo,
      disciplina: d.disciplina,
      docente: d.docente ?? '',
      titulacao: d.titulacao ?? '',
      ch: d.ch ?? '',
      nota: d.nota ?? '',
      ft: d.ft ?? '',
      status: d.status ?? 'AP',
    });
    setErro(null);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function confirmarExcluir() {
    if (excluirId == null) return;
    const res = await api.historico.excluir(excluirId);
    setExcluirId(null);
    if (res.ok) await carregarDisc();
  }

  async function gerarPdf(semAssinatura = false, senhaPfx?: string) {
    setErro(null);
    setSucesso(null);
    setGerando(true);
    setModalSenha(null);
    const res = await api.historico.gerarPdf(aluno.id, semAssinatura, senhaPfx);
    setGerando(false);
    if (res.ok && res.data) {
      setSucesso(
        res.data.enviadoWeb
          ? `Histórico gerado com QR validador em: ${res.data.pdfPath}`
          : `Histórico gerado em: ${res.data.pdfPath} (QR não registrado no serviço web — verifique a conexão)`
      );
    } else {
      setErro(res.error ?? 'Erro ao gerar PDF');
    }
  }

  async function gerarXml(senhaPfx?: string) {
    setErro(null);
    setSucesso(null);
    setGerandoXml(true);
    setModalSenha(null);
    try {
      const res = await api.historico.gerarXml(aluno.id, senhaPfx);
      if (res.ok && res.data) {
        setSucesso(res.data.aviso ?? `XML gerado em: ${res.data.xmlPath}`);
      } else if (res.error !== 'Operação cancelada') {
        setErro(res.error ?? 'Erro ao gerar XML');
      }
    } catch (e: any) {
      setErro(e?.message ?? 'Erro ao gerar XML');
    } finally {
      setGerandoXml(false);
    }
  }

  const periodos = Array.from(new Set(disciplinas.map((d) => d.periodo))).sort();

  return (
    <>
    <Modal
      title={`Histórico Acadêmico — ${aluno.nome}`}
      width={920}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Fechar
          </button>
          <button
            className="btn-ghost"
            onClick={() => setModalSenha('xml')}
            disabled={gerandoXml || gerando || disciplinas.length === 0}
          >
            {gerandoXml ? 'Gerando…' : 'Gerar Histórico (XML)'}
          </button>
          <button className="btn-primary" onClick={() => setModalSenha('pdf')} disabled={gerando || gerandoXml || disciplinas.length === 0}>
            {gerando ? 'Gerando…' : 'Gerar Histórico (PDF)'}
          </button>
          <button className="btn-ghost" onClick={() => gerarPdf(true)} disabled={gerando || gerandoXml || disciplinas.length === 0}>
            {gerando ? 'Gerando…' : 'Gerar Histórico (SA)'}
          </button>
        </>
      }
    >
      {sucesso && <div className="alert alert-success">{sucesso}</div>}
      {erro && <div className="alert alert-error">{erro}</div>}

      <div className="form-grid" style={{ marginBottom: 8 }}>
        <Campo label="Matrícula (CGA)" valor={aluno.matricula} />
        <Campo label="CPF" valor={aluno.cpf} />
        <Campo label="RG" valor={aluno.rg} />
        <Campo label="Órgão Emissor" valor={aluno.orgao_emissor} />
        <Campo label="Nacionalidade" valor={aluno.nacionalidade} />
        <Campo label="Naturalidade" valor={aluno.naturalidade} />
        <Campo label="Sexo" valor={aluno.sexo} />
        <Campo label="Data de Nascimento" valor={aluno.data_nascimento} />
        <Campo label="Faculdade" valor={aluno.faculdade} />
        <Campo label="Curso" valor={aluno.curso} />
        <Campo label="Turno" valor={aluno.turno} />
        <Campo label="Forma de Ingresso" valor={aluno.forma_ingresso} />
        <Campo label="Data Vestibular" valor={aluno.data_vestibular} />
        <Campo label="Ingresso" valor={aluno.ano_ingresso} />
        <Campo label="Conclusão" valor={aluno.ano_conclusao} />
        <Campo label="Data Colação" valor={aluno.data_colacao} />
        <Campo
          label="Cadastrado por"
          valor={
            aluno.created_by_nome
              ? `${aluno.created_by_nome}${aluno.created_by_codigo ? ` (${aluno.created_by_codigo})` : ''}`
              : '—'
          }
        />
      </div>

      <h3 style={{ fontSize: 14, margin: '18px 0 8px' }}>
        Disciplinas {disciplinas.length > 0 && `(${disciplinas.length})`}
      </h3>

      {/* formulário inline */}
      <div ref={formRef} className="card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <div>
            <label>Período *</label>
            <select value={form.periodo} onChange={(e) => setForm({ ...form, periodo: e.target.value })}>
              <option value="">Selecione…</option>
              {SEMESTRES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: 'span 3' }}>
            <label>Disciplina *</label>
            <input value={form.disciplina} onChange={(e) => setForm({ ...form, disciplina: e.target.value })} />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label>Docente</label>
            <input value={form.docente} onChange={(e) => setForm({ ...form, docente: e.target.value })} />
          </div>
          <div>
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
          <div>
            <label>CH</label>
            <input placeholder="60H" value={form.ch} onChange={(e) => setForm({ ...form, ch: e.target.value })} />
          </div>
          <div>
            <label>Nota (N/C)</label>
            <input placeholder="9.3" value={form.nota} onChange={(e) => setForm({ ...form, nota: e.target.value })} />
          </div>
          <div>
            <label>Faltas (FT)</label>
            <input placeholder="0" value={form.ft} onChange={(e) => setForm({ ...form, ft: e.target.value })} />
          </div>
          <div>
            <label>Status (STC)</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {STATUS_DISC.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: 'span 4', display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <button className="btn-primary" onClick={salvarDisc} disabled={salvando}>
              {salvando ? 'Salvando…' : editId != null ? 'Atualizar' : '+ Adicionar'}
            </button>
            {editId != null && (
              <button className="btn-ghost" onClick={resetForm}>
                Cancelar
              </button>
            )}
          </div>
        </div>
      </div>

      {/* tabela de disciplinas */}
      {carregandoDisc ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Carregando disciplinas…</p>
      ) : disciplinas.length === 0 ? (
        <div className="alert alert-warning" style={{ margin: 0 }}>
          Nenhuma disciplina cadastrada. Adicione as disciplinas para gerar o histórico.
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 80 }}>Período</th>
                <th>Disciplina</th>
                <th>Docente</th>
                <th style={{ width: 110 }}>Titulação</th>
                <th style={{ width: 60 }}>CH</th>
                <th style={{ width: 60 }}>Nota</th>
                <th style={{ width: 50 }}>FT</th>
                <th style={{ width: 60 }}>Status</th>
                <th style={{ width: 130 }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {periodos.map((p) => (
                <GrupoPeriodo
                  key={p}
                  periodo={p}
                  discs={disciplinas.filter((d) => d.periodo === p)}
                  onEdit={editar}
                  onDelete={(id) => setExcluirId(id)}
                  onMove={async (id, dir) => {
                    await api.historico.mover(id, dir);
                    await carregarDisc();
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {declaracoes.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, margin: '18px 0 8px' }}>Declarações emitidas</h3>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Emitido por</th>
                  <th>Data</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {declaracoes.map((d) => (
                  <tr key={d.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{d.codigo_verificacao.slice(0, 13)}…</td>
                    <td>{d.emitido_por_nome}</td>
                    <td>{new Date(d.emitido_em).toLocaleString('pt-BR')}</td>
                    <td>
                      <span className={d.enviado_web === 1 ? 'badge badge-ok' : 'badge badge-pendente'}>
                        {d.enviado_web === 1 ? 'No serviço web' : 'Pendente'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {excluirId != null && (
        <ConfirmDialog
          title="Excluir Disciplina"
          message="Tem certeza que deseja excluir esta disciplina do histórico?"
          confirmLabel="Excluir"
          onConfirm={confirmarExcluir}
          onCancel={() => setExcluirId(null)}
        />
      )}
    </Modal>
    {modalSenha && !gerando && !gerandoXml && (
      <ModalSenhaCertificado
        documento={modalSenha === 'xml' ? 'Histórico (XML)' : 'Histórico (PDF)'}
        onConfirm={(senha) => {
          if (modalSenha === 'xml') void gerarXml(senha);
          else void gerarPdf(false, senha);
        }}
        onClose={() => setModalSenha(null)}
      />
    )}
    </>
  );
}

function GrupoPeriodo({
  periodo,
  discs,
  onEdit,
  onDelete,
  onMove,
}: {
  periodo: string;
  discs: HistoricoDisciplina[];
  onEdit: (d: HistoricoDisciplina) => void;
  onDelete: (id: number) => void;
  onMove: (id: number, direcao: 'up' | 'down') => void;
}) {
  const chTotal = discs.reduce((s, d) => {
    const n = parseInt((d.ch ?? '').replace(/\D/g, '') || '0', 10);
    return s + (isNaN(n) ? 0 : n);
  }, 0);
  return (
    <>
      {discs.map((d, i) => (
        <tr key={d.id} style={{ background: i === 0 ? 'var(--surface-alt)' : undefined }}>
          <td style={{ fontWeight: i === 0 ? 700 : 400, fontFamily: 'monospace' }}>{i === 0 ? periodo : ''}</td>
          <td>{formatarDisciplina(d.disciplina)}</td>
          <td>{formatarDisciplina(d.docente || '—')}</td>
          <td>{d.titulacao || '—'}</td>
          <td>{d.ch || '—'}</td>
          <td>{d.nota || '—'}</td>
          <td>{d.ft || '—'}</td>
          <td>
            <span className="badge badge-ok">{d.status || '—'}</span>
          </td>
          <td>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className="btn-ghost btn-sm"
                onClick={() => onMove(d.id, 'up')}
                disabled={i === 0}
                title="Mover para cima"
                style={{ padding: '5px 8px' }}
              >
                ↑
              </button>
              <button
                className="btn-ghost btn-sm"
                onClick={() => onMove(d.id, 'down')}
                disabled={i === discs.length - 1}
                title="Mover para baixo"
                style={{ padding: '5px 8px' }}
              >
                ↓
              </button>
              <button className="btn-ghost btn-sm" onClick={() => onEdit(d)}>
                Editar
              </button>
              <button className="btn-danger btn-sm" onClick={() => onDelete(d.id)}>
                Excluir
              </button>
            </div>
          </td>
        </tr>
      ))}
      <tr style={{ background: 'var(--surface-hover)', fontWeight: 700 }}>
        <td></td>
        <td style={{ fontStyle: 'italic' }}>TOTAIS DO PERÍODO</td>
        <td colSpan={2}></td>
        <td>{chTotal}H</td>
        <td colSpan={4}></td>
      </tr>
    </>
  );
}

function Campo({ label, valor }: { label: string; valor: string | null | undefined }) {
  return (
    <div className="form-row" style={{ marginBottom: 8 }}>
      <label>{label}</label>
      <div style={{ padding: '6px 0', fontWeight: 500 }}>{valor || '—'}</div>
    </div>
  );
}
