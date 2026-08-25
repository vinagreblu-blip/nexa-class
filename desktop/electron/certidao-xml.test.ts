import { describe, expect, it } from 'vitest';
import { gerarXmlEspelho } from './certidao-xml';

const DADOS = {
  root: 'certidaoConclusao',
  tituloDocumento: 'Certidão de Conclusão de Curso',
  instituicao: { nome: 'INSTITUTO ERICH FROMM', cnpj: '03.466.601/0001-82' },
  aluno: {
    nome: 'MARIA DA SILVA', matricula: '202012345', cpf: '123.456.789-00',
    rg: '1.234.567', curso: 'ADMINISTRAÇÃO', faculdade: 'INSTITUTO ERICH FROMM',
    situacao: 'Concluído', anoConclusao: '2024', dataColacao: '20/12/2024',
  },
  documento: {
    codigoVerificacao: '11111111-2222-3333-4444-555555555555',
    hashConteudo: 'abc123def456',
    emitidoPor: 'Administrador',
    emitidoEm: '2026-08-25T15:00:00.000Z',
    urlVerificacao: 'https://nexa-verificacao.onrender.com/v/11111111-2222-3333-4444-555555555555',
  },
  geradoEm: '2026-08-25T15:00:01.000Z',
};

describe('gerarXmlEspelho (certidão XML própria)', () => {
  it('gera XML completo com código/hash/URL do documento', () => {
    const xml = gerarXmlEspelho(DADOS)!;
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<certidaoConclusao xmlns="https://nexa-class.edu/certidao">');
    expect(xml).toContain('<nome>MARIA DA SILVA</nome>');
    expect(xml).toContain('<matricula>202012345</matricula>');
    expect(xml).toContain('<codigo>11111111-2222-3333-4444-555555555555</codigo>');
    expect(xml).toContain('<hashConteudo>abc123def456</hashConteudo>');
    expect(xml).toContain('<url>https://nexa-verificacao.onrender.com/v/11111111-2222-3333-4444-555555555555</url>');
    expect(xml).toContain('<situacao>Concluído</situacao>');
  });

  it('declara explicitamente que NÃO é documento do padrão MEC', () => {
    const xml = gerarXmlEspelho(DADOS)!;
    expect(xml).toMatch(/não é documento do padrão MEC/);
  });

  it('escapa caracteres especiais (XSS/quebra de XML)', () => {
    const xml = gerarXmlEspelho({
      ...DADOS,
      aluno: { ...DADOS.aluno, nome: 'JOÃO & MARIA <TESTE>"x"' },
    })!;
    expect(xml).not.toMatch(/JOÃO & /); // & cru (não escapado) não pode existir
    expect(xml).toContain('JOÃO &amp; MARIA &lt;TESTE&gt;&quot;x&quot;');
  });

  it('aluno cursando sai com situação real (sem bloqueio)', () => {
    const xml = gerarXmlEspelho({
      ...DADOS,
      aluno: { ...DADOS.aluno, situacao: 'Cursando', anoConclusao: 'Cursando', dataColacao: null },
    })!;
    expect(xml).toContain('<situacao>Cursando</situacao>');
    expect(xml).not.toContain('<dataColacao>');
  });

  it('variante declaração de histórico usa root próprio', () => {
    const xml = gerarXmlEspelho({ ...DADOS, root: 'declaracaoAutenticidadeHistorico', tituloDocumento: 'Declaração de Autenticidade de Histórico Escolar' })!;
    expect(xml).toContain('<declaracaoAutenticidadeHistorico xmlns="https://nexa-class.edu/certidao">');
  });

  it('sem código de verificação → NULL (nunca incompleto)', () => {
    expect(gerarXmlEspelho({ ...DADOS, documento: { ...DADOS.documento, codigoVerificacao: '' } })).toBeNull();
    expect(gerarXmlEspelho({ ...DADOS, aluno: { ...DADOS.aluno, matricula: '' } as any })).toBeNull();
  });
});
