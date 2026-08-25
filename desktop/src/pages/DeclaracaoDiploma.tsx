import { useEffect, useState } from 'react';
import { api } from '../api';
import type { DiplomaRow } from '../types';
import { ModalSenhaCertificado } from '../components/ModalSenhaCertificado';
import { useSyncTempoReal } from '../utils/useSyncTempoReal';

/**
 * Página "Declaração de Autenticidade de Diploma".
 *
 * Lista os diplomas já emitidos. Para cada um, o admin pode emitir uma
 * "declaração de autenticidade" — um PDF separado que atesta que o diploma
 * referenciado (com código e data) é autêntico.
 *
 * Requisito: o diploma deve existir (foi emitido antes pela aba Diploma).
 */
export function DeclaracaoDiploma() {
  const [diplomas, setDiplomas] = useState<DiplomaRow[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [emitindoId, setEmitindoId] = useState<number | null>(null);
  const [semAssinatura, setSemAssinatura] = useState(false);
  const [modalSenhaDiploma, setModalSenhaDiploma] = useState<DiplomaRow | null>(null);

  async function carregar() {
    setCarregando(true);
    const res = await api.diplomas.listar();
    if (res.ok && res.data) setDiplomas(res.data);
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  // Tempo real: recarrega quando outra máquina emite/exclui diplomas.
  useSyncTempoReal(carregar, ['diplomas', 'declaracoes']);

  async function emitirDeclaracao(d: DiplomaRow, sa: boolean, senhaPfx?: string) {
    setEmitindoId(d.id);
    setErro(null);
    setSucesso(null);
    setModalSenhaDiploma(null);
    // Chamada ao handler de declaração com tipo='diploma' e diplomaId.
    const res = await api.declaracoes.emitir(d.aluno_id, sa, 'diploma', d.id, senhaPfx);
    setEmitindoId(null);
    if (res.ok && res.data) {
      setSucesso(
        `Declaração de autenticidade gerada em: ${(res.data as any).pdfPath}` +
          (!(res.data as any).enviadoWeb
            ? ' (não registrada no serviço web — verifique a conexão)'
            : '')
      );
    } else {
      setErro(res.error ?? 'Erro ao emitir declaração');
    }
  }

  function iniciarEmissao(d: DiplomaRow) {
    if (semAssinatura) { void emitirDeclaracao(d, true); return; }
    setModalSenhaDiploma(d);
  }

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22 }}>Declaração de Autenticidade de Diploma</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
          Selecione um diploma já emitido para gerar a declaração que atesta sua autenticidade.
          Requer que o diploma tenha sido emitido antes pela aba Diploma.
        </p>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 14,
          alignItems: 'center',
          fontSize: 13,
          color: 'var(--text-muted)',
        }}
      >
        <label>
          <input
            type="checkbox"
            checked={semAssinatura}
            onChange={(e) => setSemAssinatura(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          Emitir sem assinatura digital (SA)
        </label>
      </div>

      {sucesso && <div className="alert alert-success">{sucesso}</div>}
      {erro && <div className="alert alert-error">{erro}</div>}

      <div className="card" style={{ overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Aluno</th>
              <th>Matrícula</th>
              <th>Diploma emitido em</th>
              <th>Código do diploma</th>
              <th style={{ width: 250 }}>Ações</th>
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
            {!carregando && diplomas.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  Nenhum diploma emitido ainda. Emita diplomas pela aba <strong>Diploma</strong>{' '}
                  antes de gerar declarações de autenticidade.
                </td>
              </tr>
            )}
            {diplomas.map((d) => (
              <tr key={d.id}>
                <td>{d.aluno_nome}</td>
                <td style={{ fontFamily: 'monospace' }}>{d.aluno_matricula}</td>
                <td>{new Date(d.emitido_em).toLocaleDateString('pt-BR')}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {d.codigo_verificacao.substring(0, 13)}…
                </td>
                <td>
                  <button
                    className="btn-primary btn-sm"
                    onClick={() => iniciarEmissao(d)}
                    disabled={emitindoId === d.id}
                  >
                    {emitindoId === d.id
                      ? 'Emitindo…'
                      : semAssinatura
                        ? '+ Emitir Declaração (SA)'
                        : '+ Emitir Declaração'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalSenhaDiploma && emitindoId == null && (
        <ModalSenhaCertificado
          documento="Declaração de Diploma"
          onConfirm={(senha) => void emitirDeclaracao(modalSenhaDiploma, false, senha)}
          onClose={() => setModalSenhaDiploma(null)}
        />
      )}
    </div>
  );
}
