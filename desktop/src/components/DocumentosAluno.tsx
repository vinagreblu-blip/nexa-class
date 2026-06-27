import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AlunoDocumento } from '../types';
import { Modal } from './Modal';

export function DocumentosAluno({ alunoId }: { alunoId: number }) {
  const [docs, setDocs] = useState<AlunoDocumento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [anexando, setAnexando] = useState(false);
  const [convertendoId, setConvertendoId] = useState<number | null>(null);
  const [baixandoId, setBaixandoId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [xmlVisual, setXmlVisual] = useState<{ nome: string; conteudo: string } | null>(null);

  async function carregar() {
    setCarregando(true);
    const res = await api.documentos.listar(alunoId);
    if (res.ok && res.data) setDocs(res.data);
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
  }, [alunoId]);

  async function anexar() {
    setErro(null);
    setSucesso(null);
    setAnexando(true);
    const res = await api.documentos.adicionar(alunoId);
    setAnexando(false);
    if (res.ok && res.data) {
      setSucesso(`${res.data.length} PDF(s) anexado(s).`);
      await carregar();
      setTimeout(() => setSucesso(null), 3000);
    } else if (res.error && res.error !== 'Nenhum arquivo selecionado') {
      setErro(res.error);
    }
  }

  async function converter(id: number) {
    setErro(null);
    setSucesso(null);
    setConvertendoId(id);
    const res = await api.documentos.converterXml(id);
    setConvertendoId(null);
    if (res.ok && res.data) {
      setSucesso(`XML gerado em: ${res.data.xmlPath}`);
      await carregar();
      setTimeout(() => setSucesso(null), 5000);
    } else {
      setErro(res.error ?? 'Erro ao converter');
    }
  }

  async function baixar(id: number, tipo: 'xml' | 'pdf') {
    setErro(null);
    setSucesso(null);
    setBaixandoId(`${id}-${tipo}`);
    const res = await api.documentos.baixar(id, tipo);
    setBaixandoId(null);
    if (res.ok && res.data) {
      setSucesso(`${tipo.toUpperCase()} salvo em: ${res.data.salvoPath}`);
      setTimeout(() => setSucesso(null), 5000);
    } else if (res.error && res.error !== 'Operação cancelada') {
      setErro(res.error);
    }
  }

  async function visualizarXml(id: number) {
    setErro(null);
    const res = await api.documentos.visualizarXml(id);
    if (res.ok && res.data) {
      setXmlVisual(res.data);
    } else {
      setErro(res.error ?? 'Erro ao visualizar XML');
    }
  }

  async function excluir(id: number) {
    if (!confirm('Excluir este documento e seu XML (se houver)?')) return;
    setErro(null);
    const res = await api.documentos.excluir(id);
    if (res.ok) {
      await carregar();
    } else {
      setErro(res.error ?? 'Erro ao excluir');
    }
  }

  return (
    <div
      style={{
        marginTop: 18,
        padding: 14,
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--surface-alt)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Documentos (PDF) e XMLs</h3>
        <button className="btn-primary btn-sm" onClick={anexar} disabled={anexando}>
          {anexando ? 'Anexando…' : '+ Anexar PDF'}
        </button>
      </div>

      {sucesso && <div className="alert alert-success" style={{ marginBottom: 8 }}>{sucesso}</div>}
      {erro && <div className="alert alert-error" style={{ marginBottom: 8 }}>{erro}</div>}

      {carregando ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>Carregando…</p>
      ) : docs.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
          Nenhum documento anexado.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {docs.map((d) => {
            const convertido = d.convertido === 1;
            return (
              <div
                key={d.id}
                style={{
                  padding: '8px 10px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 16 }}>{convertido ? '📑' : '📄'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.nome}
                    </div>
                    <div style={{ fontSize: 11, marginTop: 2 }}>
                      {convertido ? (
                        <span className="badge badge-ok">XML gerado</span>
                      ) : (
                        <span className="badge badge-pendente">Sem XML</span>
                      )}
                    </div>
                  </div>
                  <button
                    className="btn-danger btn-sm"
                    onClick={() => excluir(d.id)}
                    title="Excluir documento"
                  >
                    ✕
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {!convertido && (
                    <button
                      className="btn-primary btn-sm"
                      onClick={() => converter(d.id)}
                      disabled={convertendoId === d.id}
                    >
                      {convertendoId === d.id ? 'Convertendo…' : 'Converter p/ XML'}
                    </button>
                  )}
                  {convertido && (
                    <>
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => visualizarXml(d.id)}
                        title="Ver conteúdo do XML"
                      >
                        👁️ Visualizar XML
                      </button>
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => baixar(d.id, 'xml')}
                        disabled={baixandoId === `${d.id}-xml`}
                      >
                        {baixandoId === `${d.id}-xml` ? 'Salvando…' : '⬇️ Baixar XML'}
                      </button>
                    </>
                  )}
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => baixar(d.id, 'pdf')}
                    disabled={baixandoId === `${d.id}-pdf`}
                  >
                    {baixandoId === `${d.id}-pdf` ? 'Salvando…' : '⬇️ Baixar PDF'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {xmlVisual && (
        <Modal
          title={`XML — ${xmlVisual.nome}`}
          width={720}
          onClose={() => setXmlVisual(null)}
          footer={
            <>
              <button className="btn-ghost" onClick={() => setXmlVisual(null)}>
                Fechar
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  navigator.clipboard?.writeText(xmlVisual.conteudo);
                  setSucesso('XML copiado para a área de transferência.');
                  setTimeout(() => setSucesso(null), 3000);
                }}
              >
                Copiar
              </button>
            </>
          }
        >
          <pre
            style={{
              margin: 0,
              maxHeight: '55vh',
              overflow: 'auto',
              background: 'var(--surface-alt)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: 12,
              fontSize: 12,
              fontFamily: 'Consolas, monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'var(--text)',
            }}
          >
            {xmlVisual.conteudo}
          </pre>
        </Modal>
      )}
    </div>
  );
}
