import { describe, expect, it } from 'vitest';
import { traduzirErroA3, erroCertificadoAusente, erroCertificadoExpirado, erroChaveInacessivel } from './assinatura-erros';

describe('traduzirErroA3', () => {
  it('timeout vem ANTES do ramo genérico de PIN (mensagem da falha real)', () => {
    const r = traduzirErroA3('Tempo esgotado aguardando o token/PIN. Verifique se o token está conectado e tente novamente.');
    expect(r).toMatch(/Tempo esgotado aguardando o token responder/);
    expect(r).toMatch(/nesta máquina/i);
    expect(r).not.toMatch(/^Não foi possível autenticar o PIN/);
  });

  it('timeout em inglês (timed out) também cai no ramo de timeout', () => {
    expect(traduzirErroA3('The operation has timed out.')).toMatch(/Tempo esgotado aguardando o token responder/);
  });

  it('PIN incorreto traduz corretamente', () => {
    expect(traduzirErroA3('PIN is incorrect')).toMatch(/PIN incorreto/);
  });

  it('token bloqueado traduz corretamente', () => {
    expect(traduzirErroA3('Smart card blocked after attempts')).toMatch(/BLOQUEADO/);
  });

  it('troca obrigatória de PIN tem prioridade sobre smart card', () => {
    expect(traduzirErroA3('The smart card PIN must be changed before use')).toMatch(/troca do PIN inicial/);
  });

  it('diálogo cancelado orienta procurar a janela na barra de tarefas', () => {
    expect(traduzirErroA3('User cancelled the PIN dialog')).toMatch(/barra de tarefas/);
  });

  it('cartão não detectado (sem acento e com acento)', () => {
    expect(traduzirErroA3('The smart card cannot be accessed')).toMatch(/não detectado ou driver não instalado/i);
    expect(traduzirErroA3('O cartão do token não responde')).toMatch(/não detectado ou driver não instalado/i);
  });

  it('anexa o erro original truncado em 200 chars', () => {
    const longo = 'x'.repeat(500);
    const r = traduzirErroA3('PIN is incorrect — ' + longo);
    expect(r).toContain('[Erro original: ');
    expect(r.length).toBeLessThan(500);
  });

  it('mensagem vazia não quebra', () => {
    expect(traduzirErroA3('')).toBeTruthy();
  });
});

describe('mensagens de pré-check', () => {
  it('erroCertificadoAusente explica que A3 só assina onde o token está', () => {
    const r = erroCertificadoAusente();
    expect(r).toMatch(/não encontrado nesta máquina/i);
    expect(r).toMatch(/outra máquina/i);
  });

  it('erroCertificadoExpirado informa a data de validade', () => {
    expect(erroCertificadoExpirado('20/10/2025')).toMatch(/20\/10\/2025/);
    expect(erroCertificadoExpirado('20/10/2025')).toMatch(/EXPIRADO/i);
  });

  it('erroChaveInacessivel orienta conectar o token nesta máquina', () => {
    const r = erroChaveInacessivel();
    expect(r).toMatch(/chave privada/i);
    expect(r).toMatch(/nesta máquina/i);
    expect(r).toMatch(/Conecte o token USB/i);
    expect(r).toMatch(/middleware/i);
  });
});
