import { useState } from 'react';
import { api } from '../api';

type TipoConversao = 'pdf-xml' | 'img-xml' | 'xml-pdf';

export function Conversoes() {
  const [tipo, setTipo] = useState<TipoConversao>('pdf-xml');
  const [processando, setProcessando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const opcoes: { id: TipoConversao; label: string; descricao: string; icone: string }[] = [
    { id: 'pdf-xml', label: 'PDF → XML', descricao: 'Extrai o texto de um PDF e gera um arquivo XML estruturado', icone: '📄→📑' },
    { id: 'img-xml', label: 'IMG/PNG → XML', descricao: 'Usa OCR para ler uma imagem (JPG/PNG) e gera um XML', icone: '🖼️→📑' },
    { id: 'xml-pdf', label: 'XML → PDF', descricao: 'Lê um XML e gera um PDF formatado', icone: '📑→📄' },
  ];

  async function converter() {
    setErro(null);
    setResultado(null);
    setProcessando(true);
    try {
      if (tipo === 'pdf-xml') {
        const res = await api.conversoes.pdfParaXml();
        if (res.ok && res.data) {
          setResultado(`XML gerado em: ${res.data.caminho}`);
        } else if (res.error !== 'Operação cancelada') {
          setErro(res.error ?? 'Erro na conversão');
        }
      } else if (tipo === 'img-xml') {
        const res = await api.conversoes.imgParaXml();
        if (res.ok && res.data) {
          setResultado(`XML gerado em: ${res.data.caminho}`);
        } else if (res.error !== 'Operação cancelada') {
          setErro(res.error ?? 'Erro na conversão');
        }
      } else if (tipo === 'xml-pdf') {
        const res = await api.conversoes.xmlParaPdf();
        if (res.ok && res.data) {
          setResultado(`PDF gerado em: ${res.data.caminho}`);
        } else if (res.error !== 'Operação cancelada') {
          setErro(res.error ?? 'Erro na conversão');
        }
      }
    } catch (e: any) {
      setErro(e?.message ?? 'Erro inesperado');
    }
    setProcessando(false);
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22 }}>Conversões de Arquivos</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
          Converta entre PDF, imagem e XML.
        </p>
      </div>

      {/* Seleção do tipo de conversão */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {opcoes.map((op) => (
          <button
            key={op.id}
            onClick={() => { setTipo(op.id); setErro(null); setResultado(null); }}
            style={{
              padding: 20,
              borderRadius: 10,
              border: tipo === op.id ? '2px solid var(--btn-bg)' : '1px solid var(--border)',
              background: tipo === op.id ? 'var(--surface-tint)' : 'var(--surface)',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s',
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 8 }}>{op.icone}</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, color: 'var(--text)' }}>
              {op.label}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
              {op.descricao}
            </div>
          </button>
        ))}
      </div>

      {/* Card de conversão */}
      <div className="card" style={{ padding: 28, textAlign: 'center' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>
          {opcoes.find((o) => o.id === tipo)?.icone} {opcoes.find((o) => o.id === tipo)?.label}
        </h2>
        <p style={{ margin: '0 0 24px', color: 'var(--text-muted)', fontSize: 13 }}>
          {opcoes.find((o) => o.id === tipo)?.descricao}
        </p>

        {resultado && <div className="alert alert-success" style={{ marginBottom: 16 }}>{resultado}</div>}
        {erro && <div className="alert alert-error" style={{ marginBottom: 16 }}>{erro}</div>}

        <button
          className="btn-primary"
          onClick={converter}
          disabled={processando}
          style={{ minWidth: 200 }}
        >
          {processando ? '⏳ Convertendo…' : ` Selecionar arquivo`}
        </button>

        {processando && (
          <p style={{ marginTop: 16, color: 'var(--text-muted)', fontSize: 13 }}>
            {tipo === 'img-xml' ? 'OCR em andamento (pode demorar 15-30s)…' : 'Processando…'}
          </p>
        )}
      </div>

      {/* Instruções */}
      <div className="card" style={{ padding: 18, marginTop: 18 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Como funciona cada conversão</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <InfoItem
            titulo="PDF → XML"
            texto="Seleciona um arquivo PDF → o sistema extrai todo o texto (ou usa OCR se for imagem) → gera um XML estruturado com o conteúdo. Você escolhe onde salvar o XML."
          />
          <InfoItem
            titulo="IMG/PNG → XML"
            texto="Seleciona uma imagem (JPG, JPEG, PNG) → o sistema usa OCR para ler o texto da imagem → gera um XML estruturado. Ideal para fotos de documentos."
          />
          <InfoItem
            titulo="XML → PDF"
            texto="Seleciona um arquivo XML → o sistema lê os dados estruturados (períodos, disciplinas, aluno, etc.) → gera um PDF formatado com layout de histórico acadêmico."
          />
        </div>
      </div>
    </div>
  );
}

function InfoItem({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div style={{ paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
      <strong style={{ fontSize: 13, color: 'var(--btn-bg)' }}>{titulo}</strong>
      <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{texto}</p>
    </div>
  );
}
