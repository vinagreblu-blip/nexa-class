import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  durationMs: number;
}

interface ToastContextValue {
  toasts: Toast[];
  push: (kind: ToastKind, message: string, durationMs?: number) => void;
  dismiss: (id: number) => void;
  success: (message: string, durationMs?: number) => void;
  error: (message: string, durationMs?: number) => void;
  warning: (message: string, durationMs?: number) => void;
  info: (message: string, durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string, durationMs = 4000) => {
    // Defensivo: ignora mensagens vazias (evita toasts "fantasmas") e clamp de duração.
    if (!message?.trim()) return;
    const clampedDuration = Math.max(1000, Math.min(durationMs, 30000));
    const id = nextId++;
    setToasts((cur) => [...cur.slice(-4), { id, kind, message, durationMs: clampedDuration }]); // máx 5 toasts na tela
  }, []);

  const api: ToastContextValue = {
    toasts,
    push,
    dismiss,
    success: (m, d) => push('success', m, d),
    error: (m, d) => push('error', m, d ?? 6000), // erros ficam um pouco mais
    warning: (m, d) => push('warning', m, d),
    info: (m, d) => push('info', m, d),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      style={{
        position: 'fixed',
        top: 20,
        right: 20,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 380,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, toast.durationMs);
    return () => clearTimeout(t);
  }, [toast.durationMs, onDismiss]);

  const styles: Record<ToastKind, { bg: string; border: string; icon: string }> = {
    success: { bg: 'var(--surface)', border: '#16a34a', icon: '✓' },
    error: { bg: 'var(--surface)', border: '#dc2626', icon: '✕' },
    warning: { bg: 'var(--surface)', border: '#d97706', icon: '⚠' },
    info: { bg: 'var(--surface)', border: 'var(--primary)', icon: 'ℹ' },
  };
  const s = styles[toast.kind];

  return (
    <div
      role="status"
      onClick={onDismiss}
      style={{
        background: s.bg,
        color: 'var(--text)',
        borderLeft: `4px solid ${s.border}`,
        borderRadius: 6,
        padding: '12px 16px',
        boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 14,
        cursor: 'pointer',
        pointerEvents: 'auto',
        animation: 'nexa-toast-in 0.2s ease',
      }}
    >
      <span style={{ color: s.border, fontWeight: 700, fontSize: 16 }}>{s.icon}</span>
      <span style={{ flex: 1 }}>{toast.message}</span>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast precisa estar dentro de ToastProvider');
  return ctx;
}
