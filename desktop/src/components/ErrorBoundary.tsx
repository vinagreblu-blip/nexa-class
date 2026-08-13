import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Captura erros de render do React para evitar a "tela branca" (árvore desmonta
 * totalmente quando não há boundary). Mostra uma mensagem amigável com botão de
 * recarregar. É a rede de segurança que falta no app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Mantém no console para diagnóstico — não há logger externo no renderer.
    console.error('[ErrorBoundary] erro de render:', error, info.componentStack);
  }

  private recarregar = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: 'var(--bg, #f4f6f8)',
          color: 'var(--text, #1f2d34)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            maxWidth: 480,
            background: 'var(--surface, #fff)',
            border: '1px solid var(--border, #e1ebee)',
            borderRadius: 12,
            padding: 28,
            boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
          }}
        >
          <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Ocorreu um erro inesperado</h2>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted, #6b7a82)', lineHeight: 1.5 }}>
            A tela não pôde ser carregada. Você pode tentar novamente. Se o problema persistir,
            reinicie o aplicativo.
          </p>
          {this.state.error && (
            <pre
              style={{
                margin: '0 0 16px',
                padding: 12,
                background: 'var(--surface-tint, #f8fafc)',
                border: '1px solid var(--border, #e1ebee)',
                borderRadius: 8,
                fontSize: 11,
                color: '#DC2626',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 160,
                overflow: 'auto',
              }}
            >
              {this.state.error.message}
            </pre>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={this.recarregar}
              style={{
                flex: 1,
                padding: '10px 16px',
                border: 'none',
                borderRadius: 8,
                background: 'var(--accent, #2e8bb5)',
                color: '#fff',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Tentar novamente
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                flex: 1,
                padding: '10px 16px',
                border: '1px solid var(--border, #e1ebee)',
                borderRadius: 8,
                background: 'transparent',
                color: 'var(--text, #1f2d34)',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Recarregar app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
