import { describe, it, expect } from 'vitest';
import { deveIniciarSentry, type SentryInitOpts } from './sentry';

describe('deveIniciarSentry', () => {
  it('recusa DSN ausente', () => {
    expect(deveIniciarSentry({})).toMatch(/não configurada/i);
    expect(deveIniciarSentry({ dsn: undefined })).toMatch(/não configurada/i);
  });

  it('recusa DSN vazia', () => {
    expect(deveIniciarSentry({ dsn: '' })).toMatch(/vazia/i);
    expect(deveIniciarSentry({ dsn: '   ' })).toMatch(/vazia/i);
  });

  it('recusa placeholders óbvios', () => {
    expect(deveIniciarSentry({ dsn: 'placeholder' })).toMatch(/placeholder/i);
    expect(deveIniciarSentry({ dsn: 'your-dsn-here' })).toMatch(/placeholder/i);
    expect(deveIniciarSentry({ dsn: 'your-dsn-123' })).toMatch(/placeholder/i);
  });

  it('aceita DSN válida', () => {
    const opts: SentryInitOpts = {
      dsn: 'https://abc123@sentry.io/123',
    };
    expect(deveIniciarSentry(opts)).toBeNull();
  });

  it('aceita DSN de GlitchTip (self-hosted)', () => {
    const opts: SentryInitOpts = {
      dsn: 'https://abc123@glitchtip.exemplo.com.br/1',
    };
    expect(deveIniciarSentry(opts)).toBeNull();
  });

  it('não valida formato rigorosamente — apenas rejeita ausente/placeholder', () => {
    // DSN malformada mas não-vazia passa pela validação sintática — Sentry SDK
    // vai reclamar em runtime. Mantemos a checagem shallow de propósito.
    expect(deveIniciarSentry({ dsn: 'nao-e-mas-url-valida' })).toBeNull();
  });
});
