import { describe, it, expect } from 'vitest';
import { formatarDisciplina } from './formatar';

describe('formatarDisciplina', () => {
  it('formata UPPER CASE para título mantendo palavras pequenas em minúsculo', () => {
    expect(formatarDisciplina('TEORIA GERAL DO ESTADO')).toBe('Teoria Geral do Estado');
    expect(formatarDisciplina('DIREITO CONSTITUCIONAL')).toBe('Direito Constitucional');
    expect(formatarDisciplina('INTRODUÇÃO À FILOSOFIA')).toBe('Introdução à Filosofia');
  });

  it('capitaliza palavra pequena quando é a primeira', () => {
    expect(formatarDisciplina('E CONOMIA')).toBe('E Conomia');
    expect(formatarDisciplina('DA NATUREZA')).toBe('Da Natureza');
  });

  it('preserva acentos e caracteres Unicode', () => {
    // 'E' é palavra pequena → fica minúscula no meio da frase.
    expect(formatarDisciplina('ÉTICA E CIDADANIA')).toBe('Ética e Cidadania');
    expect(formatarDisciplina('COMUNICAÇÃO E EXPRESSÃO')).toBe('Comunicação e Expressão');
  });

  it('retorna vazio para string vazia', () => {
    expect(formatarDisciplina('')).toBe('');
  });

  it('não reformata texto já misto (assume que já está formatado)', () => {
    // A função detecta que já há minúsculas e retorna como está.
    expect(formatarDisciplina('Direito Civil')).toBe('Direito Civil');
    expect(formatarDisciplina('Teoria Geral do Estado')).toBe('Teoria Geral do Estado');
  });

  it('formata string totalmente minúscula', () => {
    // 'direito civil' tem minúscula mas se mantém como está (comportamento legacy).
    // Documentado para regressão.
    expect(formatarDisciplina('direito civil')).toBe('direito civil');
  });

  it('colapsa múltiplos espaços em um só', () => {
    // split(/\s+/) colapsa runs de whitespace.
    expect(formatarDisciplina('DIREITO   CIVIL')).toBe('Direito Civil');
  });
});
