import { useState, useEffect } from 'react';
import { api } from '../api';
import type { AlunoInput } from '../types';
import { Modal } from './Modal';
import { mascararCPF } from '../utils';

const CURSOS_LIVRES_CURSOS = [
  'Seitai Cranial e Craniopuntura',
  'Seitai / New Seitai (Terapia Japonesa)',
];

const VAZIO: AlunoInput = {
  matricula: '', nome: '', cpf: '', rg: '', nacionalidade: '', naturalidade: '', cidade: '',
  sexo: '', orgao_emissor: '', turno: '', forma_ingresso: '', data_vestibular: '', data_colacao: '',
  email: '', telefone: '', curso: '', faculdade: '', ano_ingresso: '', ano_conclusao: '', data_nascimento: '',
};

interface NovoAlunoModalProps {
  aberto: boolean;
  onClose: () => void;
  onSalvo?: (alunoId: number) => void;
  origem?: string;
}

export function NovoAlunoModal({ aberto, onClose, onSalvo, origem }: NovoAlunoModalProps) {
  const [form, setForm] = useState<AlunoInput>(VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (aberto) {
      const anoAtual = `${new Date().getFullYear()}.1`;
      const rgAuto = Math.floor(10000 + Math.random() * 90000).toString();
      setForm({ ...VAZIO, faculdade: 'FACEI', ano_ingresso: anoAtual, rg: rgAuto });
      setErro(null);
    }
  }, [aberto]);

  async function salvar() {
    setErro(null);
    setSalvando(true);
    const res = await api.alunos.criar({ ...form, origem });
    setSalvando(false);
    if (res.ok && res.data) {
      onSalvo?.(res.data.id);
      onClose();
    } else {
      setErro(res.error ?? 'Erro ao salvar');
    }
  }

  if (!aberto) return null;

  return (
    <Modal
      title="Novo Aluno"
      width={640}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose} disabled={salvando}>Cancelar</button>
          <button className="btn-primary" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="form-grid">
        <div className="full form-row">
          <label>Nome Completo *</label>
          <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoFocus />
        </div>
        <div className="form-row">
          <label>CPF *</label>
          <input value={form.cpf} onChange={(e) => setForm({ ...form, cpf: mascararCPF(e.target.value) })} placeholder="000.000.000-00" maxLength={14} />
        </div>
        <div className="form-row">
          <label>Faculdade</label>
          <select value="FACEI" disabled>
            <option value="FACEI">FACEI</option>
          </select>
        </div>
        <div className="form-row">
          <label>Curso</label>
          <select value={form.curso} onChange={(e) => setForm({ ...form, curso: e.target.value })}>
            <option value="">Selecione…</option>
            {CURSOS_LIVRES_CURSOS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label>Data de Início do Curso</label>
          <input type="date" value={form.data_vestibular} onChange={(e) => setForm({ ...form, data_vestibular: e.target.value })} />
        </div>
        <div className="form-row">
          <label>Data de Conclusão do Curso</label>
          <input type="date" value={form.ano_conclusao} onChange={(e) => setForm({ ...form, ano_conclusao: e.target.value })} />
        </div>
        <div className="form-row">
          <label>Certificado Registrado em</label>
          <input type="date" value={form.data_colacao} onChange={(e) => setForm({ ...form, data_colacao: e.target.value })} />
        </div>
        <div className="form-row">
          <label>Número do Registro</label>
          <input value={form.naturalidade || ''} onChange={(e) => setForm({ ...form, naturalidade: e.target.value })} placeholder="Ex: 123" />
        </div>
        <div className="form-row">
          <label>Forma de Ingresso</label>
          <select value={form.forma_ingresso} onChange={(e) => setForm({ ...form, forma_ingresso: e.target.value })}>
            <option value="">Selecione…</option>
            <option value="ENEM">ENEM</option>
            <option value="Vestibular">Vestibular</option>
          </select>
        </div>
      </div>
    </Modal>
  );
}
