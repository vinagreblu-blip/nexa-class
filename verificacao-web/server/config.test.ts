import { describe, it, expect, afterEach } from 'vitest';
import { validarConfigProducao, DEFAULT_API_KEY } from './config';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  // Restaura NODE_ENV para não vazar estado entre testes.
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('validarConfigProducao', () => {
  it('aceita qualquer config em desenvolvimento (default)', () => {
    delete process.env.NODE_ENV;
    expect(validarConfigProducao({ apiKey: DEFAULT_API_KEY })).toBeNull();
    expect(validarConfigProducao({ apiKey: '' })).toBeNull();
    expect(validarConfigProducao({ apiKey: 'curta' })).toBeNull();
  });

  it('aceita explicitamente development', () => {
    expect(validarConfigProducao({ apiKey: DEFAULT_API_KEY, nodeEnv: 'development' })).toBeNull();
  });

  it('recusa API key default em produção', () => {
    const erro = validarConfigProducao({ apiKey: DEFAULT_API_KEY, nodeEnv: 'production' });
    expect(erro).not.toBeNull();
    expect(erro).toMatch(/default público/i);
  });

  it('recusa API key ausente em produção', () => {
    const erro = validarConfigProducao({ apiKey: '', nodeEnv: 'production' });
    expect(erro).not.toBeNull();
    expect(erro).toMatch(/ausente/i);
  });

  it('recusa API key curta (< 16 chars) em produção', () => {
    const erro = validarConfigProducao({ apiKey: 'short-key-12345', nodeEnv: 'production' });
    expect(erro).not.toBeNull();
    expect(erro).toMatch(/curta/i);
  });

  it('aceita API key forte em produção', () => {
    const forte = 'a'.repeat(64);
    expect(validarConfigProducao({ apiKey: forte, nodeEnv: 'production' })).toBeNull();
  });

  it('aceita API key de 16+ chars em produção', () => {
    expect(validarConfigProducao({ apiKey: 'key-com-16-chars', nodeEnv: 'production' })).toBeNull();
  });

  it('lê NODE_ENV de process.env quando não passado', () => {
    process.env.NODE_ENV = 'production';
    const erro = validarConfigProducao({ apiKey: DEFAULT_API_KEY });
    expect(erro).not.toBeNull();
  });

  it('DEFAULT_API_KEY é o valor legacy esperado', () => {
    // Trava o valor para garantir que mudanças conscientes quebrem testes.
    expect(DEFAULT_API_KEY).toBe('nexa-dev-api-key-trocar');
  });
});
