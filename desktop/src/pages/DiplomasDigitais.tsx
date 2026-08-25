import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useSyncTempoReal } from '../utils/useSyncTempoReal';
import { useDebouncedValue } from '../utils/hooks';
import { Modal } from '../components/Modal';

// ============================================================
// DIPLOMAS DIGITAIS MEC — página do módulo oficial (XSD v1.05)
// ============================================================
// A Certidão de Conclusão (Documentos Institucionais) segue
// existindo separadamente; aqui é o processo do Diploma Digital:
// requisitos → processo → XML oficial (M3) → assinatura/registro
// (M4, jamais simulados — cada etapa mostra o que falta).
//

interface Row {
  id: number;
  aluno_id: number;
  aluno_nome: string;
  aluno_cpf: string | null;
  matricula: string;
  curso: string | null;
  conclusao: string | null;
  colacao: string | null;
  status: string;
  versao_schema: string;
  chave_acesso: string | null;
  created_at: string;
}

const STATUS_INFO: Record<string, { label: string; cor: string; fundo: string }> = {
  aguardando_conclusao: { label: 'Aguardando conclusão', cor: '#b45309', fundo: 'rgba(217,119,6,.14)' },
  apto: { label: 'Apto para diploma', cor: '#15803d', fundo: 'rgba(22,163,74,.14)' },
  em_preparacao: { label: 'Em preparação', cor: '#1d4ed8', fundo: 'rgba(59,130,246,.14)' },
  xml_gerado: { label: 'XML gerado', cor: '#15803d', fundo: 'rgba(22,163,74,.14)' },
  xml_invalido: { label: 'XML inválido', cor: '#b91c1c', fundo: 'rgba(220,38,38,.14)' },
  aguardando_assinatura: { label: 'Aguardando assinatura', cor: '#b45309', fundo: 'rgba(217,119,6,.14)' },
  assinado: { label: 'Assinado', cor: '#15803d', fundo: 'rgba(22,163,74,.14)' },
  aguardando_registro: { label: 'Aguardando registro', cor: '#b45309', fundo: 'rgba(217,119,6,.14)' },
  registrado: { label: 'Registrado', cor: '#15803d', fundo: 'rgba(22,163,74,.14)' },
  publicado: { label: 'Publicado', cor: '#15803d', fundo: 'rgba(22,163,74,.14)' },
  anulado: { label: 'Anulado', cor: '#b91c1c', fundo: 'rgba(220,38,38,.14)' },
  cancelado: { label: 'Cancelado', cor: '#b91c1c', fundo: 'rgba(220,38,38,.14)' },
};

function StatusBadge({ status }: { status: string }) {
  const info = STATUS_INFO[status] ?? { label: status, cor: '#64748b', fundo: 'rgba(100,116,139,.14)' };
  return (
    <span className="badge" style={{ color: info.cor, background: info.fundo }}>
      {info.label}
    </span>
  );
}

const inputStyle: React.CSSProperties = { flex: 1, minWidth: 120 };
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' };
const secaoStyle: React.CSSProperties = { fontSize: 13, fontWeight: 700, marginTop: 14, marginBottom: 6, color: 'var(--text)' };

export function DiplomasDigitais() {
  const { usuario } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [busca, setBusca] = useState('');
  const buscaDebounced = useDebouncedValue(busca, 200);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [modalAbrir, setModalAbrir] = useState(false);
  const [modalInstitucional, setModalInstitucional] = useState(false);
  const [detalheId, setDetalheId] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    const r = await api.diplomasDigitais.listar(buscaDebounced || undefined);
    if (r.ok && r.data) setRows(r.data as Row[]);
  }, [buscaDebounced]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useSyncTempoReal(carregar, ['diplomas_digitais', 'alunos', 'ies', 'cursos']);

  const flashErro = (msg: string) => {
    setErro(msg);
    setSucesso('');
    setTimeout(() => setErro(''), 6000);
  };
  const flashOk = (msg: string) => {
    setSucesso(msg);
    setErro('');
    setTimeout(() => setSucesso(''), 6000);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>Diplomas Digitais</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>
            Processo oficial de Diploma Digital de graduação — especificação MEC (XSD v1.05). A Certidão de Conclusão
            continua em Documentos Institucionais.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {usuario?.role === 'admin' && (
            <button className="btn-ghost" onClick={() => setModalInstitucional(true)}>
              Cadastro Institucional
            </button>
          )}
          <button className="btn-primary" onClick={() => setModalAbrir(true)}>
            + Abrir Processo
          </button>
        </div>
      </div>

      {erro && <div className="alert alert-error" style={{ marginBottom: 12 }}>{erro}</div>}
      {sucesso && <div className="alert alert-success" style={{ marginBottom: 12 }}>{sucesso}</div>}

      <div className="card">
        <div className="form-row" style={{ marginBottom: 12 }}>
          <input
            placeholder="Buscar por aluno ou matrícula…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            style={inputStyle}
          />
        </div>
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Aluno</th>
              <th>CPF</th>
              <th>Matrícula</th>
              <th>Curso</th>
              <th>Conclusão</th>
              <th>Colação</th>
              <th>Status</th>
              <th>XML</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  Nenhum processo de diploma digital aberto. Clique em “Abrir Processo” para um aluno concluído.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    DD{String(r.id).padStart(5, '0')}
                  </span>
                </td>
                <td>{r.aluno_nome}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.aluno_cpf ?? '—'}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.matricula}</td>
                <td>{r.curso ?? '—'}</td>
                <td>{r.conclusao ?? '—'}</td>
                <td>{r.colacao ?? '—'}</td>
                <td><StatusBadge status={r.status} /></td>
                <td>
                  {r.status === 'xml_gerado' ? (
                    <span className="badge badge-ok">v{r.versao_schema}</span>
                  ) : (
                    <span className="badge" style={{ color: '#64748b', background: 'rgba(100,116,139,.14)' }}>
                      {r.status === 'xml_invalido' ? 'inválido' : 'pendente'}
                    </span>
                  )}
                </td>
                <td>
                  <button className="btn-ghost btn-sm" onClick={() => setDetalheId(r.id)}>
                    Detalhes
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalAbrir && (
        <ModalAbrirProcesso
          onClose={() => setModalAbrir(false)}
          onAberto={(nome) => {
            setModalAbrir(false);
            flashOk(`Processo de Diploma Digital aberto para ${nome} (status: Apto).`);
            void carregar();
          }}
          onErro={flashErro}
        />
      )}
      {modalInstitucional && (
        <ModalCadastroInstitucional
          onClose={() => {
            setModalInstitucional(false);
            void carregar();
          }}
          onErro={flashErro}
        />
      )}
      {detalheId != null && <ModalDetalhe id={detalheId} onClose={() => setDetalheId(null)} />}
    </div>
  );
}

// ============================================================
// Modal: Abrir Processo (alunos concluídos) + Pendências
// ============================================================

function ModalAbrirProcesso({
  onClose,
  onAberto,
  onErro,
}: {
  onClose: () => void;
  onAberto: (nomeAluno: string) => void;
  onErro: (msg: string) => void;
}) {
  const [aptos, setAptos] = useState<any[]>([]);
  const [busca, setBusca] = useState('');
  const buscaDebounced = useDebouncedValue(busca, 200);
  const [carregando, setCarregando] = useState(false);
  const [abrindoId, setAbrindoId] = useState<number | null>(null);
  const [pendenciasAluno, setPendenciasAluno] = useState<{ aluno: any; pendencias: any[] } | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const r = await api.diplomasDigitais.listarAptos(buscaDebounced || undefined);
    if (r.ok && r.data) setAptos(r.data);
    setCarregando(false);
  }, [buscaDebounced]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const abrirProcesso = async (alunoId: number, nome: string) => {
    setAbrindoId(alunoId);
    const r = await api.diplomasDigitais.criar(alunoId);
    setAbrindoId(null);
    if (r.ok) {
      onAberto(nome);
    } else {
      // Bloqueado por pendências → mostra a tela de pendências do aluno
      const p = await api.diplomasDigitais.pendencias(alunoId);
      setPendenciasAluno({ aluno: aptos.find((a) => a.id === alunoId), pendencias: p.ok && p.data ? p.data : [] });
      onErro(r.error ?? 'Diploma não pode ser gerado.');
    }
  };

  if (pendenciasAluno) {
    return (
      <ModalPendencias
        aluno={pendenciasAluno.aluno}
        pendenciasIniciais={pendenciasAluno.pendencias}
        onClose={onClose}
        onResolvido={() => {
          setPendenciasAluno(null);
          void carregar();
        }}
      />
    );
  }

  return (
    <Modal title="Abrir Processo de Diploma Digital" onClose={onClose} width={720}>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 12px' }}>
        Alunos concluídos sem processo aberto. O processo só é criado quando todos os requisitos do padrão MEC
        estão atendidos — pendências são exibidas para correção.
      </p>
      <input
        placeholder="Buscar aluno…"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        style={{ width: '100%', marginBottom: 12 }}
        autoFocus
      />
      <div style={{ maxHeight: 360, overflow: 'auto' }}>
        <table>
          <thead>
            <tr><th>Aluno</th><th>Matrícula</th><th>Curso</th><th>Conclusão</th><th /></tr>
          </thead>
          <tbody>
            {carregando && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Carregando…</td></tr>
            )}
            {!carregando && aptos.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Nenhum aluno concluído sem processo.</td></tr>
            )}
            {aptos.map((a) => (
              <tr key={a.id}>
                <td>{a.nome}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{a.matricula}</td>
                <td>{a.curso ?? '—'}</td>
                <td>{a.ano_conclusao}</td>
                <td>
                  <button
                    className="btn-primary btn-sm"
                    disabled={abrindoId !== null}
                    onClick={() => void abrirProcesso(a.id, a.nome)}
                  >
                    {abrindoId === a.id ? 'Verificando…' : 'Abrir processo'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

// ============================================================
// Modal: Pendências do Diploma (completar dados do aluno)
// ============================================================

function ModalPendencias({
  aluno,
  pendenciasIniciais,
  onClose,
  onResolvido,
}: {
  aluno: any;
  pendenciasIniciais: any[];
  onClose: () => void;
  onResolvido: () => void;
}) {
  const [pendencias, setPendencias] = useState(pendenciasIniciais);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({
    cpf: '',
    sexo: '',
    nacionalidade: '',
    rg: '',
    rgUf: '',
    dataNascimento: '',
    naturalidadeCodigoIbge: '',
    naturalidadeUf: '',
    naturalidadeEstrangeira: '',
    dataColacao: '',
  });

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const salvar = async () => {
    if (!aluno) return;
    setSalvando(true);
    const input: any = { alunoId: aluno.id };
    if (form.cpf) input.cpf = form.cpf;
    if (form.sexo) input.sexo = form.sexo;
    if (form.nacionalidade) input.nacionalidade = form.nacionalidade;
    if (form.rg) input.rg = form.rg;
    if (form.rgUf) input.rgUf = form.rgUf;
    if (form.dataNascimento) input.dataNascimento = form.dataNascimento;
    if (form.naturalidadeCodigoIbge) input.naturalidadeCodigoIbge = form.naturalidadeCodigoIbge;
    if (form.naturalidadeUf) input.naturalidadeUf = form.naturalidadeUf;
    if (form.naturalidadeEstrangeira) input.naturalidadeEstrangeira = form.naturalidadeEstrangeira;
    if (form.dataColacao) input.dataColacao = form.dataColacao;
    const r = await api.diplomasDigitais.completarAluno(input);
    setSalvando(false);
    if (!r.ok) {
      setMsg(r.error ?? 'Falha ao salvar');
      return;
    }
    const p = await api.diplomasDigitais.pendencias(aluno.id);
    const novas = p.ok && p.data ? p.data : [];
    setPendencias(novas);
    setForm({
      cpf: '', sexo: '', nacionalidade: '', rg: '', rgUf: '', dataNascimento: '',
      naturalidadeCodigoIbge: '', naturalidadeUf: '', naturalidadeEstrangeira: '', dataColacao: '',
    });
    if (novas.length === 0) onResolvido();
    else setMsg('Dados salvos. Pendências restantes abaixo.');
  };

  return (
    <Modal title={`Pendências do Diploma — ${aluno?.nome ?? 'Aluno'}`} onClose={onClose} width={860}>
      <div className="alert alert-warning" style={{ marginBottom: 12 }}>
        <strong>{pendencias.length} pendência(s)</strong> impedem a emissão do Diploma Digital. Nenhum dado é
        inventado — complete o que falta:
      </div>
      <ul style={{ margin: '0 0 16px', paddingLeft: 18, fontSize: 13 }}>
        {pendencias.map((p, i) => (
          <li key={i} style={{ marginBottom: 6 }}>
            <strong>[!]</strong> {p.campo} — <span style={{ color: 'var(--text-muted)' }}>{p.motivo}</span>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Elemento XML: <code>{p.elementoXml}</code> · {p.comoObter}
            </div>
          </li>
        ))}
      </ul>

      <div style={{ secaoStyle, fontSize: 13, fontWeight: 700, marginBottom: 8 } as React.CSSProperties}>
        Completar dados do aluno
      </div>
      <div className="form-grid">
        <div>
          <label style={labelStyle}>CPF (11 dígitos)</label>
          <input value={form.cpf} onChange={(e) => set('cpf', e.target.value)} placeholder="000.000.000-00" />
        </div>
        <div>
          <label style={labelStyle}>Sexo</label>
          <select value={form.sexo} onChange={(e) => set('sexo', e.target.value)}>
            <option value="">—</option>
            <option value="M">M</option>
            <option value="F">F</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Nacionalidade</label>
          <input value={form.nacionalidade} onChange={(e) => set('nacionalidade', e.target.value)} placeholder="Brasileiro(a)" />
        </div>
        <div>
          <label style={labelStyle}>RG (número)</label>
          <input value={form.rg} onChange={(e) => set('rg', e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>UF do RG</label>
          <input value={form.rgUf} onChange={(e) => set('rgUf', e.target.value.toUpperCase())} maxLength={2} placeholder="BA" />
        </div>
        <div>
          <label style={labelStyle}>Data de nascimento</label>
          <input value={form.dataNascimento} onChange={(e) => set('dataNascimento', e.target.value)} placeholder="DD/MM/AAAA" />
        </div>
        <div>
          <label style={labelStyle}>Naturalidade — cód. IBGE (7 dígitos)</label>
          <input
            value={form.naturalidadeCodigoIbge}
            onChange={(e) => set('naturalidadeCodigoIbge', e.target.value.replace(/\D/g, '').slice(0, 7))}
            placeholder="2927408 (Salvador)"
          />
        </div>
        <div>
          <label style={labelStyle}>UF da naturalidade</label>
          <input value={form.naturalidadeUf} onChange={(e) => set('naturalidadeUf', e.target.value.toUpperCase())} maxLength={2} />
        </div>
        <div>
          <label style={labelStyle}>Município estrangeiro (se for o caso)</label>
          <input
            value={form.naturalidadeEstrangeira}
            onChange={(e) => set('naturalidadeEstrangeira', e.target.value)}
            placeholder="Nome da cidade no exterior"
          />
        </div>
        <div>
          <label style={labelStyle}>Data de colação de grau</label>
          <input value={form.dataColacao} onChange={(e) => set('dataColacao', e.target.value)} placeholder="DD/MM/AAAA" />
        </div>
      </div>
      {msg && <div className="alert alert-error" style={{ marginTop: 12 }}>{msg}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button className="btn-ghost" onClick={onClose}>Fechar</button>
        <button className="btn-primary" disabled={salvando} onClick={() => void salvar()}>
          {salvando ? 'Salvando…' : 'Salvar e revalidar pendências'}
        </button>
      </div>
    </Modal>
  );
}

// ============================================================
// Modal: Detalhe do processo (dados + arquivos + auditoria)
// ============================================================

function ModalDetalhe({ id, onClose }: { id: number; onClose: () => void }) {
  const [dados, setDados] = useState<any | null>(null);
  useEffect(() => {
    void (async () => {
      const r = await api.diplomasDigitais.obter(id);
      if (r.ok && r.data) setDados(r.data);
    })();
  }, [id]);

  if (!dados) {
    return (
      <Modal title="Processo do Diploma Digital" onClose={onClose}>
        <p style={{ color: 'var(--text-muted)' }}>Carregando…</p>
      </Modal>
    );
  }

  return (
    <Modal title={`Processo DD${String(dados.id).padStart(5, '0')} — ${dados.aluno_nome}`} onClose={onClose} width={760}>
      <div className="form-grid">
        <div><label style={labelStyle}>Status</label><StatusBadge status={dados.status} /></div>
        <div><label style={labelStyle}>Versão do schema</label><span style={{ fontFamily: 'monospace' }}>{dados.versao_schema}</span></div>
        <div><label style={labelStyle}>IES emissora</label>{dados.ies_emissora_nome ?? '—'}</div>
        <div><label style={labelStyle}>Curso</label>{dados.curso ?? '—'}</div>
        <div><label style={labelStyle}>Matrícula</label><span style={{ fontFamily: 'monospace' }}>{dados.matricula}</span></div>
        <div><label style={labelStyle}>Colação</label>{dados.data_colacao ?? '—'}</div>
      </div>

      <div style={secaoStyle}>Artefatos XML</div>
      {(!dados.arquivos || dados.arquivos.length === 0) && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          Nenhum XML gerado. A geração validada contra o XSD oficial será habilitada na próxima etapa do módulo (M3).
        </p>
      )}
      {!!dados.arquivos?.length && (
        <table>
          <thead><tr><th>Tipo</th><th>Versão</th><th>Válido (XSD)</th><th>Gerado em</th></tr></thead>
          <tbody>
            {dados.arquivos.map((a: any) => (
              <tr key={a.id}>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{a.tipo_arquivo}</td>
                <td>{a.versao_schema}</td>
                <td>
                  {a.valido_xsd === 1 ? (
                    <span className="badge badge-ok">válido</span>
                  ) : a.valido_xsd === 0 ? (
                    <span className="badge" style={{ color: '#b91c1c', background: 'rgba(220,38,38,.14)' }}>inválido</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{a.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={secaoStyle}>Assinaturas</div>
      {(!dados.assinaturas || dados.assinaturas.length === 0) && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          Assinatura digital (XAdES com certificado ICP-Brasil da IES) será configurada na etapa M4 — nada é simulado.
        </p>
      )}

      <div style={secaoStyle}>Histórico de auditoria</div>
      <div style={{ maxHeight: 180, overflow: 'auto' }}>
        <table>
          <thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Resultado</th></tr></thead>
          <tbody>
            {(dados.auditoria ?? []).map((a: any) => (
              <tr key={a.id}>
                <td style={{ fontSize: 12 }}>{a.created_at}</td>
                <td>{a.usuario_nome}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{a.acao}</td>
                <td>{a.resultado}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

// ============================================================
// Modal: Cadastro Institucional (IES + cursos de graduação)
// ============================================================

const TIPOS_ATO = ['Parecer', 'Resolução', 'Decreto', 'Portaria', 'Deliberação', 'Despacho', 'Lei Federal', 'Lei Estadual', 'Lei Municipal', 'Ato Próprio'];
const TITULOS = ['', 'Licenciado', 'Tecnólogo', 'Bacharel', 'Médico'];
const GRAUS = ['', 'Bacharelado', 'Licenciatura', 'Tecnólogo', 'Curso sequencial'];
const UFS_BR = ['','AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

function CampoAto({
  titulo,
  valor,
  onChange,
}: {
  titulo: string;
  valor: { tipo: string; numero: string; data: string };
  onChange: (v: { tipo: string; numero: string; data: string }) => void;
}) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{titulo}</div>
      <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <div>
          <label style={labelStyle}>Tipo</label>
          <select value={valor.tipo} onChange={(e) => onChange({ ...valor, tipo: e.target.value })}>
            {TIPOS_ATO.map((t) => <option key={t} value={t}>{t || '—'}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Número</label>
          <input value={valor.numero} onChange={(e) => onChange({ ...valor, numero: e.target.value })} placeholder="ex.: 123 ou S/N" />
        </div>
        <div>
          <label style={labelStyle}>Data (AAAA-MM-DD)</label>
          <input value={valor.data} onChange={(e) => onChange({ ...valor, data: e.target.value })} placeholder="2020-01-31" />
        </div>
      </div>
    </div>
  );
}

function atoJson(a: { tipo: string; numero: string; data: string }): string | undefined {
  if (!a.tipo || !a.numero || !a.data) return undefined;
  return JSON.stringify(a);
}

function ModalCadastroInstitucional({ onClose, onErro }: { onClose: () => void; onErro: (m: string) => void }) {
  const [vista, setVista] = useState<'ies' | 'cursos'>('ies');
  const [iesLista, setIesLista] = useState<any[]>([]);
  const [salvando, setSalvando] = useState(false);

  const [ies, setIes] = useState({
    id: undefined as number | undefined,
    nome: '',
    codigoEmec: '',
    cnpj: '',
    papel: 'emissora',
    logradouro: '', numero: '', complemento: '', bairro: '',
    codigoMunicipio: '', nomeMunicipio: '', uf: '', cep: '',
  });
  const [credenciamento, setCredenciamento] = useState({ tipo: '', numero: '', data: '' });

  const [cursos, setCursos] = useState<any[]>([]);
  const [curso, setCurso] = useState({
    id: undefined as number | undefined,
    iesId: '',
    nome: '',
    codigoEmec: '',
    modalidade: '',
    tituloConferido: '',
    outroTitulo: '',
    grauConferido: '',
  });
  const [autorizacao, setAutorizacao] = useState({ tipo: '', numero: '', data: '' });
  const [reconhecimento, setReconhecimento] = useState({ tipo: '', numero: '', data: '' });

  const carregar = useCallback(async () => {
    const r = await api.diplomasDigitais.iesListar();
    if (r.ok && r.data) {
      setIesLista(r.data);
      const emissora = (r.data as any[]).find((i) => i.papel === 'emissora' && i.ativo === 1);
      if (emissora && !ies.id) {
        setIes({
          id: emissora.id, nome: emissora.nome ?? '', codigoEmec: emissora.codigo_emec?.toString() ?? '',
          cnpj: emissora.cnpj ?? '', papel: emissora.papel ?? 'emissora',
          logradouro: emissora.logradouro ?? '', numero: emissora.numero ?? '',
          complemento: emissora.complemento ?? '', bairro: emissora.bairro ?? '',
          codigoMunicipio: emissora.codigo_municipio ?? '', nomeMunicipio: emissora.nome_municipio ?? '',
          uf: emissora.uf ?? '', cep: emissora.cep ?? '',
        });
        if (emissora.credenciamento_json) {
          try { setCredenciamento(JSON.parse(emissora.credenciamento_json)); } catch { /* ignora */ }
        }
      }
    }
    const c = await api.diplomasDigitais.cursoGraduacaoListar();
    if (c.ok && c.data) setCursos(c.data);
  }, [ies.id]);

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const salvarIes = async () => {
    setSalvando(true);
    const r = await api.diplomasDigitais.iesSalvar({
      id: ies.id,
      nome: ies.nome,
      codigoEmec: ies.codigoEmec ? Number(ies.codigoEmec.replace(/\D/g, '')) : undefined,
      cnpj: ies.cnpj || undefined,
      papel: ies.papel,
      logradouro: ies.logradouro || undefined,
      numero: ies.numero || undefined,
      complemento: ies.complemento || undefined,
      bairro: ies.bairro || undefined,
      codigoMunicipio: ies.codigoMunicipio || undefined,
      nomeMunicipio: ies.nomeMunicipio || undefined,
      uf: ies.uf || undefined,
      cep: ies.cep || undefined,
      credenciamentoJson: atoJson(credenciamento),
    });
    setSalvando(false);
    if (!r.ok) {
      onErro(r.error ?? 'Falha ao salvar IES');
      return;
    }
    await carregar();
  };

  const salvarCurso = async () => {
    if (!curso.iesId) {
      onErro('Selecione a IES do curso.');
      return;
    }
    setSalvando(true);
    const r = await api.diplomasDigitais.cursoGraduacaoSalvar({
      id: curso.id,
      iesId: Number(curso.iesId),
      nome: curso.nome,
      codigoEmec: curso.codigoEmec ? Number(curso.codigoEmec.replace(/\D/g, '')) : undefined,
      modalidade: curso.modalidade || undefined,
      tituloConferido: curso.tituloConferido && curso.tituloConferido !== 'Outro' ? curso.tituloConferido : undefined,
      outroTitulo: curso.tituloConferido === 'Outro' ? curso.outroTitulo : undefined,
      grauConferido: curso.grauConferido || undefined,
      autorizacaoJson: atoJson(autorizacao),
      reconhecimentoJson: atoJson(reconhecimento),
    });
    setSalvando(false);
    if (!r.ok) {
      onErro(r.error ?? 'Falha ao salvar curso');
      return;
    }
    setCurso({ id: undefined, iesId: curso.iesId, nome: '', codigoEmec: '', modalidade: '', tituloConferido: '', outroTitulo: '', grauConferido: '' });
    setAutorizacao({ tipo: '', numero: '', data: '' });
    setReconhecimento({ tipo: '', numero: '', data: '' });
    await carregar();
  };

  const editCurso = (c: any) => {
    setCurso({
      id: c.id, iesId: String(c.ies_id), nome: c.nome ?? '', codigoEmec: c.codigo_emec?.toString() ?? '',
      modalidade: c.modalidade ?? '', tituloConferido: c.outro_titulo ? 'Outro' : (c.titulo_conferido ?? ''),
      outroTitulo: c.outro_titulo ?? '', grauConferido: c.grau_conferido ?? '',
    });
    const parse = (j: string | null) => {
      if (!j) return { tipo: '', numero: '', data: '' };
      try { return JSON.parse(j); } catch { return { tipo: '', numero: '', data: '' }; }
    };
    setAutorizacao(parse(c.autorizacao_json));
    setReconhecimento(parse(c.reconhecimento_json));
  };

  return (
    <Modal title="Cadastro Institucional — dados oficiais exigidos pelo MEC" onClose={onClose} width={880}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button className={vista === 'ies' ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} onClick={() => setVista('ies')}>IES</button>
        <button className={vista === 'cursos' ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} onClick={() => setVista('cursos')}>Cursos de Graduação</button>
      </div>

      {vista === 'ies' && (
        <>
          {iesLista.length > 1 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px' }}>
              {iesLista.length} IES cadastradas — editando: <strong>{ies.nome || '—'}</strong>
            </p>
          )}
          <div className="form-grid">
            <div className="full">
              <label style={labelStyle}>Nome da IES *</label>
              <input value={ies.nome} onChange={(e) => setIes({ ...ies, nome: e.target.value })} placeholder="INSTITUTO ERICH FROMM" />
            </div>
            <div>
              <label style={labelStyle}>Código e-MEC da IES</label>
              <input value={ies.codigoEmec} onChange={(e) => setIes({ ...ies, codigoEmec: e.target.value.replace(/\D/g, '') })} />
            </div>
            <div>
              <label style={labelStyle}>CNPJ (14 dígitos)</label>
              <input value={ies.cnpj} onChange={(e) => setIes({ ...ies, cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
            </div>
            <div>
              <label style={labelStyle}>Papel</label>
              <select value={ies.papel} onChange={(e) => setIes({ ...ies, papel: e.target.value })}>
                <option value="emissora">Emissora</option>
                <option value="registradora">Registradora</option>
                <option value="emissora_registradora">Emissora e Registradora</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Logradouro</label>
              <input value={ies.logradouro} onChange={(e) => setIes({ ...ies, logradouro: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Número</label>
              <input value={ies.numero} onChange={(e) => setIes({ ...ies, numero: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Complemento</label>
              <input value={ies.complemento} onChange={(e) => setIes({ ...ies, complemento: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Bairro</label>
              <input value={ies.bairro} onChange={(e) => setIes({ ...ies, bairro: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Município — código IBGE (7)</label>
              <input value={ies.codigoMunicipio} onChange={(e) => setIes({ ...ies, codigoMunicipio: e.target.value.replace(/\D/g, '').slice(0, 7) })} />
            </div>
            <div>
              <label style={labelStyle}>Nome do município</label>
              <input value={ies.nomeMunicipio} onChange={(e) => setIes({ ...ies, nomeMunicipio: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>UF</label>
              <select value={ies.uf} onChange={(e) => setIes({ ...ies, uf: e.target.value })}>
                {UFS_BR.map((u) => <option key={u} value={u}>{u || '—'}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>CEP (8 dígitos)</label>
              <input value={ies.cep} onChange={(e) => setIes({ ...ies, cep: e.target.value })} placeholder="00000000" />
            </div>
          </div>
          <CampoAto titulo="Credenciamento da IES" valor={credenciamento} onChange={setCredenciamento} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn-primary" disabled={salvando || !ies.nome.trim()} onClick={() => void salvarIes()}>
              {salvando ? 'Salvando…' : ies.id ? 'Atualizar IES' : 'Cadastrar IES'}
            </button>
          </div>
        </>
      )}

      {vista === 'cursos' && (
        <>
          <div className="form-grid">
            <div>
              <label style={labelStyle}>IES *</label>
              <select value={curso.iesId} onChange={(e) => setCurso({ ...curso, iesId: e.target.value })}>
                <option value="">Selecione…</option>
                {iesLista.map((i) => <option key={i.id} value={String(i.id)}>{i.nome}</option>)}
              </select>
            </div>
            <div className="full">
              <label style={labelStyle}>Nome do curso (igual ao cadastrado nos alunos) *</label>
              <input value={curso.nome} onChange={(e) => setCurso({ ...curso, nome: e.target.value })} placeholder="ADMINISTRAÇÃO" />
            </div>
            <div>
              <label style={labelStyle}>Código e-MEC do curso</label>
              <input value={curso.codigoEmec} onChange={(e) => setCurso({ ...curso, codigoEmec: e.target.value.replace(/\D/g, '') })} />
            </div>
            <div>
              <label style={labelStyle}>Modalidade</label>
              <select value={curso.modalidade} onChange={(e) => setCurso({ ...curso, modalidade: e.target.value })}>
                <option value="">—</option>
                <option value="Presencial">Presencial</option>
                <option value="EAD">EAD</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Título conferido</label>
              <select value={curso.tituloConferido} onChange={(e) => setCurso({ ...curso, tituloConferido: e.target.value })}>
                {TITULOS.map((t) => <option key={t} value={t}>{t || '—'}</option>)}
                <option value="Outro">Outro…</option>
              </select>
            </div>
            {curso.tituloConferido === 'Outro' && (
              <div>
                <label style={labelStyle}>Outro título</label>
                <input value={curso.outroTitulo} onChange={(e) => setCurso({ ...curso, outroTitulo: e.target.value })} />
              </div>
            )}
            <div>
              <label style={labelStyle}>Grau conferido</label>
              <select value={curso.grauConferido} onChange={(e) => setCurso({ ...curso, grauConferido: e.target.value })}>
                {GRAUS.map((g) => <option key={g} value={g}>{g || '—'}</option>)}
              </select>
            </div>
          </div>
          <CampoAto titulo="Autorização do curso" valor={autorizacao} onChange={setAutorizacao} />
          <CampoAto titulo="Reconhecimento do curso" valor={reconhecimento} onChange={setReconhecimento} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn-primary" disabled={salvando || !curso.nome.trim() || !curso.iesId} onClick={() => void salvarCurso()}>
              {salvando ? 'Salvando…' : curso.id ? 'Atualizar curso' : 'Cadastrar curso'}
            </button>
          </div>

          {cursos.length > 0 && (
            <table style={{ marginTop: 14 }}>
              <thead><tr><th>Curso</th><th>e-MEC</th><th>Modalidade</th><th>Grau</th><th /></tr></thead>
              <tbody>
                {cursos.map((c) => (
                  <tr key={c.id}>
                    <td>{c.nome}</td>
                    <td>{c.codigo_emec ?? '—'}</td>
                    <td>{c.modalidade ?? '—'}</td>
                    <td>{c.grau_conferido ?? '—'}</td>
                    <td>
                      <button className="btn-ghost btn-sm" onClick={() => editCurso(c)}>Editar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Modal>
  );
}
