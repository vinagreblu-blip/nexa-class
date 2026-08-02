import { ReactNode, useState, useEffect, useRef } from 'react';

export interface ModalProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  width?: number;
}

export function Modal({ title, children, onClose, footer, width }: ModalProps) {
  // Fecha com Escape + foca o modal ao abrir (a11y básica).
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Foca o container para que Escape funcione mesmo sem input autofocus.
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal"
        style={width ? { maxWidth: width, outline: 'none' } : { outline: 'none' }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  danger = true,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn-ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button
            className={danger ? 'btn-danger' : 'btn-primary'}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                // Reset para permitir reabrir/confirmar — antes o botão ficava travado para sempre.
                setBusy(false);
              }
            }}
          >
            {busy ? 'Aguarde…' : confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{message}</p>
    </Modal>
  );
}
