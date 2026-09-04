import { describe, expect, it } from 'vitest';
import { el, elAttrs } from './xml-utils';

// ============================================================
// xml-utils — primitivas de montagem do XML oficial.
// v1.4.11: el() aplica TRIM no conteúdo (o padrão TString do XSD do
// MEC proíbe espaço no início/fim — caso real: tipoProcesso
// "RECONHECIMENTO DE CURSO " invalidava o documento inteiro).
// ============================================================

describe('el (elemento simples)', () => {
  it('escapa o valor', () => {
    expect(el('Nome', 'A & B <C>')).toBe('<Nome>A &amp; B &lt;C&gt;</Nome>');
  });
  it('null/undefined → elemento vazio', () => {
    expect(el('X', null)).toBe('<X></X>');
    expect(el('X', undefined)).toBe('<X></X>');
  });
  it('número → string', () => {
    expect(el('CodigoCursoEMEC', 20807)).toBe('<CodigoCursoEMEC>20807</CodigoCursoEMEC>');
  });
  it('TRIM: espaço nas pontas é removido (padrão TString do XSD)', () => {
    expect(el('TipoProcesso', 'RECONHECIMENTO DE CURSO ')).toBe('<TipoProcesso>RECONHECIMENTO DE CURSO</TipoProcesso>');
    expect(el('Nome', '  João  ')).toBe('<Nome>João</Nome>');
    expect(el('X', '   ')).toBe('<X></X>');
  });
});

describe('elAttrs (elemento com atributos)', () => {
  it('atributos escapados, null ignorado', () => {
    expect(elAttrs('DadosDiploma', { id: 'Dip123', versao: null as unknown as string }, '<Aluno/>'))
      .toBe('<DadosDiploma id="Dip123"><Aluno/></DadosDiploma>');
  });
});
