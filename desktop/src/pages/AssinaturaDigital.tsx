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
  const [uploadCert, setUploadingCert] = useState(false);
  const [temCert, setTemCert] = useState(false);

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
      if (res.data.imagem_path) {
        try {
          const fs = require('fs');
          const buf = fs.readFileSync(res.data.imagem_path);
          const ext = res.data.imagem_path.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
          setImgPreview(`data:image/${ext};base64,${buf.toString('base64')}`);
        } catch { setImgPreview(null); }
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

  async function enviarCertificado() {
    setErro(null);
    setSucesso(null);
    setUploadingCert(true);
    const res = await api.assinatura.uploadCert();
    setUploadingCert(false);
    if (res.ok && res.data) {
      setSucesso('Certificado digital carregado com sucesso! Já pode assinar XMLs.');
      setTemCert(true);
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
                <span className="badge badge-ok">✅ .pfx carregado</span>
              ) : (
                <span className="badge badge-pendente">❌ Não cadastrado</span>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Necessário para assinar XMLs (padrão XMLDSig)
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
        <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Certificado Digital (.pfx / .p12)</h3>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-muted)' }}>
          Faça upload do seu certificado A1 (ICP-Brasil) para assinar documentos XML com padrão XMLDSig (W3C).
          A senha não é armazenada — é solicitada apenas no momento da assinatura.
        </p>
        <button className="btn-primary" onClick={enviarCertificado} disabled={uploadCert} style={{ width: '100%' }}>
          {uploadCert ? 'Selecione o arquivo…' : temCert ? 'Trocar Certificado' : 'Carregar Certificado'}
        </button>
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
