import { describe, it, expect } from 'vitest';
import { deveIniciarSentry } from './sentry-config';

// Reuso dos mesmos casos do web — a função pura é idêntica, mas cada workspace
// tem sua cópia para manter isolamento (não há shared/ entre workspaces).
describe('deveIniciarSentry (desktop)', () => {
  it('recusa DSN ausente', () => {
    expect(deveIniciarSentry({})).toMatch(/não configurada/i);
  });

  it('recusa DSN vazia', () => {
    expect(deveIniciarSentry({ dsn: '' })).toMatch(/vazia/i);
  });

  it('recusa placeholders', () => {
    expect(deveIniciarSentry({ dsn: 'placeholder' })).toMatch(/placeholder/i);
    expect(deveIniciarSentry({ dsn: 'your-dsn-here' })).toMatch(/placeholder/i);
  });

  it('aceita DSN aparentemente válida', () => {
    expect(
      deveIniciarSentry({ dsn: 'https://abc123@sentry.io/123' })
    ).toBeNull();
  });
});
