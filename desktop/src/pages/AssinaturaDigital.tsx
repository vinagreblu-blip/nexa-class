import { useEffect, useState } from 'react';
import { api } from '../api';
import { Modal } from '../components/Modal';

interface AssinaturaData {
  id: number;
  nome_signatario: string;
  cargo: string;
  imagem_path: string | null;
  certificado_path: string | null;
  ativo: number;
}

export function AssinaturaDigital() {
  const [assinatura, setAssinatura] = useState<AssinaturaData | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [nome, setNome] = useState('');
  const [cargo, setCargo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [imgPreview, setImgPreview] = useState<string | null>(null);

  // Certificado
  const [uploadCert, setUploadingCert] = useState<string | false>(false);
  const [temCert, setTemCert] = useState(false);
  const [tipoCert, setTipoCert] = useState<'A1' | 'A3' | null>(null);

  // Assinar XML
  const [modalAssinar, setModalAssinar] = useState(false);
  const [xmlInput, setXmlInput] = useState('');
  const [senhaPfx, setSenhaPfx] = useState('');
  const [assinando, setAssinando] = useState(false);
  const [xmlResultado, setXmlResultado] = useState<string | null>(null);

  async function carregar() {
    setCarregando(true);
    const res = await api.assinatura.obter();
    if (res.ok && res.data) {
      setAssinatura(res.data);
      setNome(res.data.nome_signatario);
      setCargo(res.data.cargo);
      setTemCert(!!res.data.certificado_path);
      setTipoCert(res.data.certificado_path?.includes('A3') ? 'A3' : 'A1');
      if (res.data.imagem_path) {
        // Busca preview via IPC — NÃO usar require('fs') no renderer.
        const preview = await api.assinatura.previewImagem();
        setImgPreview(preview.ok && preview.data ? preview.data.dataUrl : null);
      } else {
        setImgPreview(null);
      }
    }
    setCarregando(false);
  }

  useEffect(() => { carregar(); }, []);

  async function salvar() {
    setErro(null);
    setSucesso(null);
    if (!nome.trim()) { setErro('Nome do signatário é obrigatório'); return; }
    if (!cargo.trim()) { setErro('Cargo é obrigatório'); return; }
    setSalvando(true);
    const res = await api.assinatura.salvar({ nome_signatario: nome.trim(), cargo: cargo.trim() });
    setSalvando(false);
    if (res.ok && res.data) {
      setSucesso('Assinatura cadastrada/atualizada com sucesso!');
      await carregar();
      setTimeout(() => setSucesso(null), 4000);
    } else if (res.error !== 'Nenhum arquivo selecionado') {
      setErro(res.error ?? 'Erro ao salvar');
    }
  }

  async function enviarCertificado(tipo: 'A1' | 'A3') {
    setErro(null);
    setSucesso(null);
    setUploadingCert(tipo);
    const res = await api.assinatura.uploadCert(tipo);
    setUploadingCert(false);
    if (res.ok && res.data) {
      setTemCert(true);
      setTipoCert(tipo);
      setSucesso(`Certificado ${tipo} carregado com sucesso! Já pode assinar documentos.`);
      setTimeout(() => setSucesso(null), 4000);
    } else if (res.error !== 'Nenhum arquivo selecionado') {
      setErro(res.error ?? 'Erro ao carregar certificado');
    }
  }

  async function assinarXml() {
    setErro(null);
    if (!xmlInput.trim()) { setErro('Cole o conteúdo XML a ser assinado'); return; }
    if (!senhaPfx) { setErro('Digite a senha do certificado'); return; }
    setAssinando(true);
    const res = await api.assinatura.assinarXml(xmlInput, senhaPfx);
    setAssinando(false);
    if (res.ok && res.data) {
      setXmlResultado(res.data.xml);
    } else {
      setErro(res.error ?? 'Erro ao assinar XML');
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22 }}>Assinatura Digital</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
          Cadastre a assinatura (imagem + certificado digital) para assinar documentos.
        </p>
      </div>

      {sucesso && <div className="alert alert-success">{sucesso}</div>}
      {erro && <div className="alert alert-error">{erro}</div>}

      {/* Status atual */}
      {!carregando && (
        <div className="card" style={{ padding: 22, marginBottom: 18 }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 14 }}>Status da Assinatura</h3>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {/* Imagem */}
            <div style={{ textAlign: 'center', minWidth: 200 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Imagem</div>
              {imgPreview ? (
                <img src={imgPreview} alt="Assinatura" style={{ maxHeight: 60, maxWidth: '100%' }} />
              ) : (
                <span className="badge badge-pendente">Não cadastrada</span>
              )}
              <div style={{ fontWeight: 600, fontSize: 13, marginTop: 4 }}>{assinatura?.nome_signatario || '—'}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{assinatura?.cargo || '—'}</div>
            </div>
            {/* Certificado */}
            <div style={{ textAlign: 'center', minWidth: 200 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Certificado Digital</div>
              {temCert ? (
                <span className="badge badge-ok">✅ {tipoCert || 'A1'} carregado</span>
              ) : (
                <span className="badge badge-pendente">❌ Não cadastrado</span>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                {temCert ? `Tipo: ${tipoCert || 'A1'}` : 'Importe A1 ou A3 para assinar documentos'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Imagem da assinatura */}
      <div className="card" style={{ padding: 22, marginBottom: 18 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 14 }}>Imagem da Assinatura</h3>
        <div className="form-row">
          <label>Nome do Signatário *</label>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Prof. Dr. José Augusto Maciel Torres" />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>Cargo *</label>
          <input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Ex: Diretor Geral" />
        </div>
        <button className="btn-primary" onClick={salvar} disabled={salvando || !nome.trim() || !cargo.trim()} style={{ marginTop: 16, width: '100%' }}>
          {salvando ? 'Salvando… (selecione a imagem)' : assinatura ? 'Atualizar Imagem' : 'Cadastrar Imagem'}
        </button>
      </div>

      {/* Certificado Digital */}
      <div className="card" style={{ padding: 22, marginBottom: 18 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Certificado Digital ICP-Brasil</h3>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-muted)' }}>
          Importe seu certificado para assinar documentos XML com padrão XMLDSig (W3C).
          A senha não é armazenada — é solicitada apenas no momento da assinatura.
        </p>

        {/* Tipo do certificado atual */}
        {temCert && (
          <div style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--surface-tint)', borderRadius: 8, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="badge badge-ok">✅ Certificado carregado</span>
            <span style={{ color: 'var(--text-muted)' }}>
              {assinatura?.certificado_path?.includes('A3') ? 'Tipo: A3 (Token)' : 'Tipo: A1 (Arquivo)'}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          {/* A1 */}
          <div style={{ flex: 1, border: '2px solid var(--border)', borderRadius: 12, padding: 18, textAlign: 'center' }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#DBEAFE', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px', color: '#2563EB' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </div>
            <h4 style={{ margin: '0 0 4px', fontSize: 14, color: '#0F172A' }}>Certificado A1</h4>
            <p style={{ margin: '0 0 12px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Baseado em software (.pfx/.p12). Válido por 1 ano.
            </p>
            <button
              className="btn-primary"
              onClick={() => enviarCertificado('A1')}
              disabled={!!uploadCert}
              style={{ width: '100%', fontSize: 13, padding: '8px 14px' }}
            >
              {uploadCert === 'A1' ? 'Selecione…' : temCert ? 'Trocar A1' : 'Importar A1'}
            </button>
          </div>

          {/* A3 */}
          <div style={{ flex: 1, border: '2px solid var(--border)', borderRadius: 12, padding: 18, textAlign: 'center' }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px', color: '#22C55E' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L8 8h3v6h2V8h3l-4-6z"/><rect x="6" y="16" width="12" height="6" rx="1"/><path d="M10 19h4"/></svg>
            </div>
            <h4 style={{ margin: '0 0 4px', fontSize: 14, color: '#0F172A' }}>Certificado A3</h4>
            <p style={{ margin: '0 0 12px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Baseado em hardware (Token USB/SmartCard). Válido até 3 anos.
            </p>
            <button
              className="btn-primary"
              onClick={() => enviarCertificado('A3')}
              disabled={!!uploadCert}
              style={{ width: '100%', fontSize: 13, padding: '8px 14px', background: '#22C55E' }}
            >
              {uploadCert === 'A3' ? 'Selecione…' : temCert ? 'Trocar A3' : 'Importar A3'}
            </button>
          </div>
        </div>
      </div>

      {/* Assinar XML */}
      <div className="card" style={{ padding: 22, marginBottom: 18 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Assinar Documento XML</h3>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-muted)' }}>
          Cole o conteúdo XML que deseja assinar. O resultado terá um bloco <code>&lt;ds:Signature&gt;</code> com padrão XMLDSig (sha256 + rsa).
        </p>
        {temCert ? (
          <button className="btn-primary" onClick={() => { setModalAssinar(true); setXmlInput(''); setSenhaPfx(''); setXmlResultado(null); setErro(null); }} style={{ width: '100%' }}>
            Assinar XML
          </button>
        ) : (
          <div className="alert alert-warning" style={{ marginBottom: 0 }}>
            Carregue um certificado digital primeiro para habilitar a assinatura XML.
          </div>
        )}
      </div>

      {/* Info */}
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Como funciona a assinatura XML</h3>
        <ol style={{ margin: 0, paddingLeft: 20, color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.8 }}>
          <li>Carregue seu <strong>certificado .pfx</strong> (ICP-Brasil A1)</li>
          <li>Cole o <strong>XML</strong> que deseja assinar</li>
          <li>Digite a <strong>senha</strong> do certificado (não é armazenada)</li>
          <li>O sistema gera o XML assinado com bloco <strong>&lt;ds:Signature&gt;</strong></li>
          <li>O XML assinado pode ser validado por qualquer sistema compatível com <strong>XMLDSig</strong></li>
        </ol>
      </div>

      {/* Modal Assinar XML */}
      {modalAssinar && (
        <Modal
          title="Assinar XML com Certificado Digital"
          width={720}
          onClose={() => setModalAssinar(false)}
          footer={
            <>
              <button className="btn-ghost" onClick={() => setModalAssinar(false)}>Fechar</button>
              {!xmlResultado && (
                <button className="btn-primary" onClick={assinarXml} disabled={assinando || !xmlInput.trim() || !senhaPfx}>
                  {assinando ? 'Assinando…' : 'Assinar XML'}
                </button>
              )}
            </>
          }
        >
          {erro && <div className="alert alert-error">{erro}</div>}

          {!xmlResultado ? (
            <>
              <div className="form-row">
                <label>Senha do Certificado *</label>
                <input
                  type="password"
                  value={senhaPfx}
                  onChange={(e) => setSenhaPfx(e.target.value)}
                  placeholder="Senha do arquivo .pfx"
                  autoFocus
                  autoComplete="off"
                />
              </div>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Conteúdo XML *</label>
                <textarea
                  value={xmlInput}
                  onChange={(e) => setXmlInput(e.target.value)}
                  placeholder="<?xml version='1.0'?>..."
                  style={{ minHeight: 200, fontFamily: 'monospace', fontSize: 12 }}
                />
              </div>
            </>
          ) : (
            <>
              <div className="alert alert-success">XML assinado com sucesso! Bloco &lt;ds:Signature&gt; adicionado.</div>
              <textarea
                readOnly
                value={xmlResultado}
                style={{ minHeight: 300, fontFamily: 'monospace', fontSize: 11 }}
                onFocus={(e) => e.target.select()}
              />
              <button
                className="btn-primary"
                style={{ marginTop: 8, width: '100%' }}
                onClick={() => {
                  navigator.clipboard?.writeText(xmlResultado);
                  setSucesso('XML copiado para a área de transferência!');
                  setTimeout(() => setSucesso(null), 3000);
                  setModalAssinar(false);
                }}
              >
                Copiar XML Assinado
              </button>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
