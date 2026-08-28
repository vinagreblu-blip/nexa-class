import { useEffect, useState } from 'react';
import { api } from '../api';
import { Modal } from '../components/Modal';
import { useSyncTempoReal } from '../utils/useSyncTempoReal';

/** Extrai o CN= de um Subject X.500 (ex: "CN=FULANO DE TAL:12345678901,O=ICP-Brasil"). */
function extrairCN(subject?: string | null): string {
  if (!subject) return '—';
  const m = subject.match(/CN=([^,]+)/i);
  if (!m) return subject;
  return m[1].split(':')[0].trim();
}

/** Formata data ISO para dd/mm/aaaa. */
function formatarData(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR');
  } catch {
    return iso;
  }
}

interface AssinaturaData {
  id: number;
  nome_signatario: string;
  cargo: string;
  imagem_path: string | null;
  certificado_path: string | null;
  certificado_tipo: 'A1' | 'A3' | null;
  certificado_a3_thumbprint: string | null;
  ativo: number;
}

interface CertA3 {
  thumbprint: string;
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
  hasPrivateKey: boolean;
  keyAcessivel: boolean;
  algorithm: string;
  store: string;
}

interface TesteA3Resultado {
  encontrado: boolean;
  certificados: { store: string; algorithm: string; keyAcessivel: boolean }[];
  assinou: boolean;
  erro?: string;
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
  const [infoA3, setInfoA3] = useState<CertA3 | null>(null);

  // Modal A3 (lista do Windows Certificate Store)
  const [modalA3, setModalA3] = useState(false);
  const [certsA3, setCertsA3] = useState<CertA3[]>([]);
  const [carregandoCerts, setCarregandoCerts] = useState(false);
  const [certA3Sel, setCertA3Sel] = useState<string | null>(null);
  const [erroA3, setErroA3] = useState<string | null>(null);

  // Teste de assinatura A3
  const [testando, setTestando] = useState(false);
  const [testeResultado, setTesteResultado] = useState<TesteA3Resultado | null>(null);
  const [testeErro, setTesteErro] = useState<string | null>(null);

  // Assinar XML
  const [modalAssinar, setModalAssinar] = useState(false);
  const [xmlInput, setXmlInput] = useState('');
  const [senhaPfx, setSenhaPfx] = useState('');
  const [assinando, setAssinando] = useState(false);
  const [xmlResultado, setXmlResultado] = useState<string | null>(null);

  // Carimbo do tempo (TSA) — XAdES-T do Diploma Digital
  const [tsaUrl, setTsaUrl] = useState('');
  const [tsaUsuario, setTsaUsuario] = useState('');
  const [tsaSenha, setTsaSenha] = useState('');
  const [tsaTemSenha, setTsaTemSenha] = useState(false);
  const [tsaSalvando, setTsaSalvando] = useState(false);
  const [tsaTestando, setTsaTestando] = useState(false);
  const [tsaMsg, setTsaMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  // Política de assinatura (XAdES-EPES)
  const [polModo, setPolModo] = useState<'padrao' | 'custom' | 'bes'>('padrao');
  const [polIdentificador, setPolIdentificador] = useState('');
  const [polDigest, setPolDigest] = useState('');
  const [polSpuri, setPolSpuri] = useState('');
  const [polPadrao, setPolPadrao] = useState({ identificador: '', digestBase64: '', spuri: '' });
  const [polSalvando, setPolSalvando] = useState(false);
  const [polConfirmando, setPolConfirmando] = useState(false);
  const [polMsg, setPolMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await api.assinatura.tsaObter();
      if (r.ok && r.data) {
        setTsaUrl(r.data.url);
        setTsaUsuario(r.data.usuario ?? '');
        setTsaTemSenha(r.data.temSenha);
      }
      const p = await api.assinatura.politicaObter();
      if (p.ok && p.data) {
        setPolModo(p.data.modo);
        setPolIdentificador(p.data.identificador || p.data.padraoIdentificador);
        setPolDigest(p.data.digestBase64 || p.data.padraoDigestBase64);
        setPolSpuri(p.data.spuri || p.data.padraoSpuri);
        setPolPadrao({
          identificador: p.data.padraoIdentificador,
          digestBase64: p.data.padraoDigestBase64,
          spuri: p.data.padraoSpuri,
        });
      }
    })();
  }, []);

  const salvarTsa = async () => {
    setTsaMsg(null);
    setTsaSalvando(true);
    const r = await api.assinatura.tsaSalvar({
      url: tsaUrl,
      usuario: tsaUsuario || undefined,
      senha: tsaSenha || undefined,
      manterSenhaAtual: !tsaSenha,
    });
    setTsaSalvando(false);
    if (r.ok) {
      setTsaTemSenha(!!r.data?.temSenha);
      setTsaSenha('');
      setTsaMsg({ tipo: 'ok', texto: 'TSA salvo. Use o "Testar carimbo" para confirmar que o serviço responde.' });
    } else {
      setTsaMsg({ tipo: 'erro', texto: r.error ?? 'Falha ao salvar' });
    }
  };

  const testarTsa = async () => {
    setTsaMsg(null);
    setTsaTestando(true);
    const r = await api.assinatura.tsaTestar();
    setTsaTestando(false);
    if (r.ok) {
      setTsaMsg({ tipo: 'ok', texto: `Carimbo OK — TSA retornou ${r.data?.genTime} (token de ${r.data?.bytes} bytes).` });
    } else {
      setTsaMsg({ tipo: 'erro', texto: r.error ?? 'Falha no teste' });
    }
  };

  const salvarPolitica = async () => {
    setPolMsg(null);
    setPolSalvando(true);
    const r = await api.assinatura.politicaSalvar({
      modo: polModo,
      identificador: polIdentificador,
      digestBase64: polDigest,
      spuri: polSpuri,
    });
    setPolSalvando(false);
    if (r.ok) {
      setPolMsg({
        tipo: 'ok',
        texto:
          polModo === 'bes'
            ? 'Salvo: assinaturas serão XAdES-BES (SEM política).'
            : polModo === 'custom'
              ? 'Política customizada salva. Use "Confirmar digest" para verificar contra o documento oficial do SPURI.'
              : 'Salvo: política padrão PA-AD-RC v2.4 (ICP-Brasil).',
      });
    } else {
      setPolMsg({ tipo: 'erro', texto: r.error ?? 'Falha ao salvar' });
    }
  };

  const confirmarPolitica = async () => {
    setPolMsg(null);
    setPolConfirmando(true);
    const r = await api.assinatura.politicaConfirmar({
      spuri: polModo === 'custom' ? polSpuri : polPadrao.spuri,
      digestBase64: polModo === 'custom' ? polDigest : polPadrao.digestBase64,
    });
    setPolConfirmando(false);
    if (!r.ok) {
      setPolMsg({ tipo: 'erro', texto: r.error ?? 'Falha ao confirmar' });
      return;
    }
    setPolMsg(
      r.data?.confere
        ? { tipo: 'ok', texto: `Digest CONFIRMADO: o SHA-256 (exc-C14N) do documento oficial em ${r.data.spuriUsado} corresponde ao configurado.` }
        : {
            tipo: 'erro',
            texto: `Digest NÃO confere! Calculado a partir do documento oficial (${r.data?.spuriUsado}): ${r.data?.calculado} — corrija antes de assinar (digest não se inventa).`,
          }
    );
  };

  async function carregar() {
    setCarregando(true);
    const res = await api.assinatura.obter();
    if (res.ok && res.data) {
      const data = res.data;
      setAssinatura(data);
      setNome(data.nome_signatario);
      setCargo(data.cargo);
      const tipo = data.certificado_tipo === 'A3' ? 'A3' : data.certificado_path ? 'A1' : null;
      setTipoCert(tipo);
      setTemCert(!!(tipo || data.certificado_path));
      setInfoA3(null);
      if (tipo === 'A3' && data.certificado_a3_thumbprint) {
        // Busca dados do cert A3 atual no Windows Certificate Store.
        // Protegido com try/catch + timeout (igual ao abrirModalA3) para não
        // quebrar o carregamento da tela se o driver do token travar a leitura.
        try {
          const lista = await Promise.race([
            api.assinatura.listarCertsA3(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('tempo esgotado')), 30000)
            ),
          ]);
          if (lista.ok && lista.data) {
            const atual = lista.data.find((c) => c.thumbprint.toUpperCase() === data.certificado_a3_thumbprint?.toUpperCase());
            setInfoA3(atual ?? null);
          }
        } catch {
          // Token desconectado/driver travado — mantém infoA3 null (status mostra "reconecte").
        }
      }
      if (data.imagem_path) {
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

  // Tempo real: recarrega quando outra máquina atualiza a assinatura digital.
  useSyncTempoReal(carregar, ['assinaturas']);

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
    if (tipoCert !== 'A3' && !senhaPfx) { setErro('Digite a senha do certificado'); return; }
    setAssinando(true);
    const res = await api.assinatura.assinarXml(xmlInput, senhaPfx);
    setAssinando(false);
    if (res.ok && res.data) {
      setXmlResultado(res.data.xml);
    } else {
      setErro(res.error ?? 'Erro ao assinar XML');
    }
  }

  async function abrirModalA3() {
    setErro(null);
    setSucesso(null);
    setModalA3(true);
    setCertA3Sel(null);
    setErroA3(null);
    setCertsA3([]);
    setCarregandoCerts(true);
    try {
      // Timeout client-side: garante que o modal nunca fique preso em "carregando".
      const res = await Promise.race([
        api.assinatura.listarCertsA3(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('tempo esgotado (30s) — o driver do token pode estar travando a leitura')), 30000)
        ),
      ]);
      if (res.ok && res.data) {
        setCertsA3(res.data);
        if (res.data.length === 0) {
          setErroA3('Nenhum certificado encontrado no Windows Certificate Store. Confirme se o token/pendrive está conectado e se o driver do fabricante (Safenet/Pronova/Gemalto) está instalado.');
        }
      } else {
        setErroA3(res.error ?? 'Erro ao ler certificados');
      }
    } catch (e: any) {
      setErroA3('Não foi possível ler o repositório do Windows: ' + (e?.message ?? 'erro desconhecido') + '. Se o token está conectado, tente reconectá-lo e instalar/atualizar o driver do fabricante.');
    } finally {
      setCarregandoCerts(false);
    }
  }

  async function confirmarA3() {
    if (!certA3Sel) { setErroA3('Selecione um certificado'); return; }
    setErro(null);
    const res = await api.assinatura.salvarCertA3(certA3Sel);
    if (res.ok) {
      setModalA3(false);
      setSucesso('Certificado A3 vinculado com sucesso! O PIN será solicitado pelo driver do token ao assinar.');
      await carregar();
      setTimeout(() => setSucesso(null), 5000);
    } else {
      setErro(res.error ?? 'Erro ao vincular certificado A3');
    }
  }

  async function testarAssinaturaA3() {
    setErro(null);
    setTesteResultado(null);
    setTesteErro(null);
    setTestando(true);
    const res = await api.assinatura.testarA3();
    setTestando(false);
    if (res.ok && res.data) {
      setTesteResultado(res.data);
    } else {
      setTesteErro(res.error ?? 'Erro ao executar o teste de assinatura');
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
                {temCert
                  ? (tipoCert === 'A3'
                      ? (infoA3
                          ? (infoA3.keyAcessivel
                              ? `${extrairCN(infoA3.subject)} · válido até ${formatarData(infoA3.notAfter)}`
                              : `${extrairCN(infoA3.subject)} · chave inacessível — instale o middleware do token`)
                          : 'Token não conectado — reconecte e reimporte')
                      : `Tipo: ${tipoCert || 'A1'}`)
                  : 'Importe A1 ou A3 para assinar documentos'}
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
              {tipoCert === 'A3'
                ? `Tipo: A3 (Token)${infoA3 ? ' · ' + extrairCN(infoA3.subject) : ''}`
                : (assinatura?.certificado_path?.includes('A3') ? 'Tipo: A3 (Token)' : 'Tipo: A1 (Arquivo)')}
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
              onClick={abrirModalA3}
              disabled={!!uploadCert}
              style={{ width: '100%', fontSize: 13, padding: '8px 14px', background: '#22C55E' }}
            >
              {temCert && tipoCert === 'A3' ? 'Trocar A3' : 'Importar A3'}
            </button>
          </div>
        </div>

        {/* Teste de assinatura A3 (sem emitir documento) */}
        {tipoCert === 'A3' && (
          <div style={{ marginTop: 16, padding: 14, border: '2px dashed var(--border)', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 13 }}>
                <strong>Testar assinatura do token</strong>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  Verifica o certificado vinculado e assina um payload de teste (o driver do token pede o PIN). Não emite documento.
                </div>
              </div>
              <button className="btn-primary" onClick={testarAssinaturaA3} disabled={testando} style={{ fontSize: 13, padding: '8px 14px', whiteSpace: 'nowrap' }}>
                {testando ? 'Testando… (aguarde o PIN)' : 'Testar assinatura'}
              </button>
            </div>

            {testeErro && (
              <div className="alert alert-error" style={{ marginTop: 12, marginBottom: 0 }}>{testeErro}</div>
            )}

            {testeResultado && (
              <div style={{ marginTop: 12 }}>
                {testeResultado.assinou ? (
                  <div className="alert alert-success" style={{ marginBottom: 8 }}>
                    ✅ <strong>Assinatura de teste concluída</strong> — o token assina normalmente. A emissão de documentos deve funcionar.
                  </div>
                ) : !testeResultado.encontrado ? (
                  <div className="alert alert-error" style={{ marginBottom: 8 }}>
                    ❌ Certificado vinculado <strong>não encontrado</strong> no repositório do Windows. Reimporte o A3 (botão acima).
                  </div>
                ) : testeResultado.certificados.every((c) => !c.keyAcessivel) ? (
                  <div className="alert alert-error" style={{ marginBottom: 8 }}>
                    ❌ Certificado encontrado, mas a <strong>chave privada não abre</strong> — token desconectado ou middleware do fabricante com problema. Verifique o utilitário do middleware (ícone perto do relógio) e reconecte o token.
                  </div>
                ) : (
                  <div className="alert alert-error" style={{ marginBottom: 8 }}>
                    ❌ A chave abre, mas a <strong>assinatura de teste falhou</strong>: {testeResultado.erro || 'erro desconhecido (PIN cancelado ou recusado?)'}
                  </div>
                )}
                {testeResultado.certificados.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {testeResultado.certificados.map((c, i) => (
                      <div key={i}>
                        Cópia em <strong>{c.store}</strong> · algoritmo <strong>{c.algorithm}</strong> · chave {c.keyAcessivel ? 'acessível' : 'inacessível'}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
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
                <button className="btn-primary" onClick={assinarXml} disabled={assinando || !xmlInput.trim() || (tipoCert !== 'A3' && !senhaPfx)}>
                  {assinando ? 'Assinando…' : 'Assinar XML'}
                </button>
              )}
            </>
          }
        >
          {erro && <div className="alert alert-error">{erro}</div>}

          {!xmlResultado ? (
            <>
              {tipoCert === 'A3' ? (
                <div className={assinando ? 'alert alert-warning' : 'alert alert-warning'} style={{ marginBottom: 12 }}>
                  {assinando ? (
                    <>⏳ <strong>Aguardando PIN</strong> no driver do token. Digite o PIN na janela que apareceu e aguarde…</>
                  ) : (
                    <>Certificado <strong>A3 (Token)</strong>: a senha (PIN) será solicitada pelo <strong>driver do token</strong> ao assinar. Conecte o token/SmartCard antes de continuar.</>
                  )}
                </div>
              ) : (
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
              )}
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

      {/* Carimbo do Tempo (TSA) — XAdES-T do Diploma Digital */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Carimbo do Tempo (TSA) — XAdES-T</h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px' }}>
          A política de assinatura do Diploma Digital (IN Sesu 1/2020) exige carimbo do tempo criptográfico no
          Histórico e no Diploma. Cadastre o serviço de carimbo (TSA) da IES — geralmente fornecido pela mesma
          empresa do certificado digital (URL no formato https://tsa.fornecedor.com.br/tsp, protocolo RFC 3161).
          Sem TSA configurado, as assinaturas saem como XAdES-BES com aviso de pendência.
        </p>
        <div className="form-grid">
          <div className="full">
            <label>URL do TSA (RFC 3161) *</label>
            <input value={tsaUrl} onChange={(e) => setTsaUrl(e.target.value)} placeholder="https://tsa.fornecedor.com.br/tsp" />
          </div>
          <div>
            <label>Usuário (se o TSA exigir)</label>
            <input value={tsaUsuario} onChange={(e) => setTsaUsuario(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <label>Senha {tsaTemSenha ? '(salva — deixe vazio para manter)' : '(se exigir)'}</label>
            <input type="password" value={tsaSenha} onChange={(e) => setTsaSenha(e.target.value)} autoComplete="new-password" />
          </div>
        </div>
        {tsaMsg && <div className={tsaMsg.tipo === 'ok' ? 'alert alert-success' : 'alert alert-error'}>{tsaMsg.texto}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn-primary" disabled={tsaSalvando || !tsaUrl.trim()} onClick={() => void salvarTsa()}>
            {tsaSalvando ? 'Salvando…' : 'Salvar TSA'}
          </button>
          <button className="btn-ghost" disabled={tsaTestando || !tsaUrl.trim()} onClick={() => void testarTsa()}>
            {tsaTestando ? 'Carimbando…' : 'Testar carimbo'}
          </button>
        </div>
      </div>

      {/* Política de Assinatura (XAdES-EPES) */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Política de Assinatura — XAdES-EPES</h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px' }}>
          O XAdES-EPES identifica a política de assinatura no XML (identificador + digest SHA-256 + SPURI). O
          digest <strong>não se inventa</strong>: é o SHA-256 sobre a forma exclusive-C14N do documento oficial da
          política. Padrão do app: <strong>PA-AD-RC v2.4</strong> (ICP-Brasil, {polPadrao.identificador}), digest
          confirmado por dois motores independentes (.NET XmlDsigExcC14NTransform e xml-crypto). Use
          "Confirmar digest" para re-verificar contra o documento oficial no SPURI.
        </p>
        <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
          {([
            { modo: 'padrao' as const, titulo: 'Padrão (PA-AD-RC v2.4)', desc: 'Política ICP-Brasil homologada, já com digest confirmado' },
            { modo: 'custom' as const, titulo: 'Personalizada', desc: 'Outra política oficial — confirme o digest antes de salvar' },
            { modo: 'bes' as const, titulo: 'Sem política (XAdES-BES)', desc: 'Assinatura sem SignaturePolicyIdentifier' },
          ]).map((op) => (
            <label
              key={op.modo}
              style={{
                display: 'flex', gap: 10, alignItems: 'flex-start', padding: 12, cursor: 'pointer',
                border: `2px solid ${polModo === op.modo ? '#22C55E' : 'var(--border)'}`, borderRadius: 10, flex: 1, minWidth: 220,
              }}
            >
              <input type="radio" name="polModo" checked={polModo === op.modo} onChange={() => {
                setPolModo(op.modo);
                if (op.modo === 'padrao') {
                  setPolIdentificador(polPadrao.identificador);
                  setPolDigest(polPadrao.digestBase64);
                  setPolSpuri(polPadrao.spuri);
                }
              }} style={{ marginTop: 3 }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#0F172A' }}>{op.titulo}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{op.desc}</div>
              </div>
            </label>
          ))}
        </div>
        <div className="form-grid">
          <div>
            <label>Identificador (OID como URN) *</label>
            <input
              value={polIdentificador}
              onChange={(e) => setPolIdentificador(e.target.value)}
              placeholder="urn:oid:2.16.76.1.7.1.9.2.4"
              disabled={polModo !== 'custom'}
              style={{ fontFamily: 'monospace' }}
            />
          </div>
          <div>
            <label>Digest SHA-256 (base64) *</label>
            <input
              value={polDigest}
              onChange={(e) => setPolDigest(e.target.value)}
              placeholder="SHA-256 da forma exc-C14N do documento da política"
              disabled={polModo !== 'custom'}
              style={{ fontFamily: 'monospace' }}
            />
          </div>
          <div className="full">
            <label>SPURI (URL do documento oficial da política)</label>
            <input
              value={polSpuri}
              onChange={(e) => setPolSpuri(e.target.value)}
              placeholder="http://politicas.icpbrasil.gov.br/PA_AD_RC_v2_4.xml"
              disabled={polModo !== 'custom'}
            />
          </div>
        </div>
        {polMsg && <div className={polMsg.tipo === 'ok' ? 'alert alert-success' : 'alert alert-error'}>{polMsg.texto}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn-primary" disabled={polSalvando} onClick={() => void salvarPolitica()}>
            {polSalvando ? 'Salvando…' : 'Salvar política'}
          </button>
          <button className="btn-ghost" disabled={polConfirmando} onClick={() => void confirmarPolitica()}>
            {polConfirmando ? 'Confirmando…' : 'Confirmar digest'}
          </button>
        </div>
      </div>

      {/* Modal Selecionar A3 (Windows Certificate Store) */}
      {modalA3 && (
        <Modal
          title="Selecionar Certificado A3 (Windows Certificate Store)"
          width={680}
          onClose={() => setModalA3(false)}
          footer={
            <>
              <button className="btn-ghost" onClick={() => setModalA3(false)}>Cancelar</button>
              <button className="btn-primary" onClick={confirmarA3} disabled={!certA3Sel}>
                Vincular certificado
              </button>
            </>
          }
        >
          {erroA3 && <div className="alert alert-error">{erroA3}</div>}
          {carregandoCerts ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Lendo repositório do Windows…</div>
          ) : certsA3.length === 0 ? (
            <div className="alert alert-warning" style={{ marginBottom: 0 }}>
              Nenhum certificado encontrado. Conecte o token/SmartCard e instale o middleware do fabricante (Safenet, Pronova, Gemalto…).
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {certsA3.map((c) => {
                const sel = certA3Sel === c.thumbprint;
                const expirado = new Date(c.notAfter) < new Date();
                return (
                  <label
                    key={`${c.store}-${c.thumbprint}`}
                    style={{
                      display: 'flex', gap: 12, alignItems: 'flex-start', padding: 12,
                      border: `2px solid ${sel ? '#22C55E' : 'var(--border)'}`, borderRadius: 10, cursor: 'pointer',
                      opacity: expirado ? 0.55 : 1,
                    }}
                  >
                    <input
                      type="radio"
                      name="certA3"
                      checked={sel}
                      onChange={() => setCertA3Sel(c.thumbprint)}
                      disabled={expirado}
                      title={expirado ? 'Certificado vencido — não pode ser vinculado' : undefined}
                      style={{ marginTop: 3 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#0F172A' }}>{extrairCN(c.subject)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        Emissor: {extrairCN(c.issuer)}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        Algoritmo: {c.algorithm || 'RSA'} · Repositório: {c.store === 'LocalMachine' ? 'LocalMachine (máquina)' : 'CurrentUser (usuário)'}
                      </div>
                      <div style={{ fontSize: 11, color: expirado ? '#DC2626' : 'var(--text-muted)', marginTop: 2 }}>
                        Válido até: {formatarData(c.notAfter)} {expirado ? '· EXPIRADO — renove com a autoridade certificadora' : ''}
                      </div>
                      {!c.keyAcessivel && !expirado && (
                        <div style={{ fontSize: 11, color: '#DC2626', marginTop: 2, fontWeight: 600 }}>
                          ⚠ Chave não acessível — token desconectado ou middleware do fabricante não instalado
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'monospace' }}>
                        {c.thumbprint}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
