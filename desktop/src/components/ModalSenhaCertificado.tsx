import { useEffect, useState } from 'react';
import { api } from '../api';
import { Modal } from './Modal';

interface AssinaturaInfo {
  certificado_tipo: 'A1' | 'A3' | null;
  certificado_path: string | null;
  certificado_a3_thumbprint: string | null;
  nome_signatario: string | null;
}

export interface ModalSenhaCertificadoProps {
  /** Texto que explica o que será assinado. */
  documento: string;
  onConfirm: (senha: string) => void;
  onClose: () => void;
}

/**
 * Modal de pré-assinatura.
 * - A1 (.pfx): pede a senha do certificado (não é armazenada).
 * - A3 (token): avisa que o PIN será solicitado pelo driver do token.
 * - Sem certificado: avisa que o documento será gerado SEM assinatura digital.
 */
export function ModalSenhaCertificado({ documento, onConfirm, onClose }: ModalSenhaCertificadoProps) {
  const [info, setInfo] = useState<AssinaturaInfo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [senha, setSenha] = useState('');

  useEffect(() => {
    let ativo = true;
    (async () => {
      const res = await api.assinatura.obter();
      if (!ativo) return;
      if (res.ok && res.data) {
        setInfo({
          certificado_tipo: res.data.certificado_tipo,
          certificado_path: res.data.certificado_path,
          certificado_a3_thumbprint: res.data.certificado_a3_thumbprint,
          nome_signatario: res.data.nome_signatario,
        });
      }
      setCarregando(false);
    })();
    return () => { ativo = false; };
  }, []);

  const tipo: 'A1' | 'A3' | null =
    info?.certificado_tipo === 'A3' ? 'A3' : info?.certificado_path ? 'A1' : null;

  const confirmar = () => {
    if (tipo === 'A1' && !senha) return;
    onConfirm(senha);
  };

  return (
    <Modal
      title="Assinar documento digitalmente"
      width={520}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          {tipo ? (
            <button
              className="btn-primary"
              onClick={confirmar}
              disabled={carregando || (tipo === 'A1' && !senha)}
            >
              {tipo === 'A3' ? 'Assinar (PIN no token)' : 'Assinar documento'}
            </button>
          ) : (
            <button className="btn-primary" onClick={() => onConfirm('')}>
              Gerar sem assinatura digital
            </button>
          )}
        </>
      }
    >
      {carregando ? (
        <div style={{ padding: 16, color: 'var(--text-muted)' }}>Verificando certificado…</div>
      ) : !tipo ? (
        <div className="alert alert-warning" style={{ marginBottom: 0 }}>
          Não há <strong>certificado digital</strong> cadastrado. O <strong>{documento}</strong> será
          gerado <strong>sem assinatura digital</strong> (apenas com a imagem da assinatura).
          Para assinar, cadastre um certificado A1 ou A3 em <strong>Assinatura Digital</strong>.
        </div>
      ) : tipo === 'A3' ? (
        <>
          <div className="alert alert-info" style={{ marginBottom: 12 }}>
            Certificado <strong>A3 (Token)</strong> — {info?.nome_signatario || '—'}.
            A senha (PIN) será solicitada pelo <strong>driver do token</strong> ao gerar o {documento}.
            Conecte o token/SmartCard antes de continuar.
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Clique em <strong>“Assinar (PIN no token)”</strong> e digite o PIN na janela que aparecerá.
            A janela do PIN é aberta pelo driver do fabricante e pode abrir <strong>atrás</strong> do app —
            se não aparecer, procure-a na barra de tarefas.
          </div>
        </>
      ) : (
        <>
          <div className="alert alert-info" style={{ marginBottom: 12 }}>
            Certificado <strong>A1 (.pfx)</strong> — {info?.nome_signatario || '—'}.
            Informe a senha do certificado para assinar o {documento}. A senha não é armazenada.
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Senha do certificado (.pfx) *</label>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="Senha do arquivo .pfx"
              autoFocus
              autoComplete="off"
              onKeyDown={(e) => { if (e.key === 'Enter' && senha) confirmar(); }}
            />
          </div>
        </>
      )}
    </Modal>
  );
}
