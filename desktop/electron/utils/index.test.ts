import { describe, it, expect } from 'vitest';
import {
  gerarHashConteudo,
  escapeXml,
  formatarDataHoraBrasilia,
  formatarDataExtensoBrasilia,
  extrairJPEGsDoPDF,
} from './index';
import type { Aluno } from '../types';

// Aluno canônico usado nos testes. Apenas os campos lidos por gerarHashConteudo
// importam; o resto é preenchido para satisfazer o tipo.
const alunoBase: Aluno = {
  id: 42,
  matricula: '2024001',
  nome: 'João da Silva',
  cpf: '12345678900',
  rg: null,
  nacionalidade: null,
  naturalidade: null,
  cidade: null,
  sexo: null,
  orgao_emissor: null,
  turno: null,
  forma_ingresso: null,
  data_vestibular: null,
  data_colacao: null,
  email: null,
  telefone: null,
  curso: 'Direito',
  faculdade: null,
  ano_ingresso: null,
  ano_conclusao: null,
  data_nascimento: null,
  created_at: '',
  updated_at: '',
};

describe('gerarHashConteudo', () => {
  it('é determinístico para o mesmo payload', () => {
    const iso = '2026-08-10T12:00:00.000Z';
    const h1 = gerarHashConteudo(alunoBase, iso);
    const h2 = gerarHashConteudo(alunoBase, iso);
    expect(h1).toBe(h2);
  });

  it('produz SHA-256 em hex (64 chars)', () => {
    const h = gerarHashConteudo(alunoBase, '2026-08-10T12:00:00.000Z');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('muda ao alterar qualquer campo do payload', () => {
    const iso = '2026-08-10T12:00:00.000Z';
    const base = gerarHashConteudo(alunoBase, iso);

    const mudouNome = gerarHashConteudo({ ...alunoBase, nome: 'Maria' }, iso);
    const mudouMatricula = gerarHashConteudo({ ...alunoBase, matricula: '999' }, iso);
    const mudouCpf = gerarHashConteudo({ ...alunoBase, cpf: '00000000000' }, iso);
    const mudouCurso = gerarHashConteudo({ ...alunoBase, curso: 'Medicina' }, iso);
    const mudouIso = gerarHashConteudo(alunoBase, '2027-01-01T00:00:00.000Z');

    expect(mudouNome).not.toBe(base);
    expect(mudouMatricula).not.toBe(base);
    expect(mudouCpf).not.toBe(base);
    expect(mudouCurso).not.toBe(base);
    expect(mudouIso).not.toBe(base);
  });

  it('trata cpf/curso nulos sem lançar', () => {
    const nulo: Aluno = { ...alunoBase, cpf: null, curso: null };
    const h = gerarHashConteudo(nulo, '2026-08-10T12:00:00.000Z');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    // Nulos viram string vazia no payload — diff em relação à versão preenchida.
    expect(h).not.toBe(gerarHashConteudo(alunoBase, '2026-08-10T12:00:00.000Z'));
  });
});

describe('escapeXml', () => {
  it('escapa os 5 caracteres XML especiais', () => {
    expect(escapeXml('&')).toBe('&amp;');
    expect(escapeXml('<')).toBe('&lt;');
    expect(escapeXml('>')).toBe('&gt;');
    expect(escapeXml('"')).toBe('&quot;');
    expect(escapeXml("'")).toBe('&apos;');
  });

  it('não altera texto sem especiais', () => {
    expect(escapeXml('João da Silva 2026')).toBe('João da Silva 2026');
  });

  it('escapa múltiplas ocorrências na string', () => {
    expect(escapeXml('<a href="x">&y</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;y&lt;/a&gt;');
  });
});

describe('formatarDataHoraBrasilia', () => {
  it('formata ISO UTC para "dd/mm/aaaa, hh:mm" no fuso de Brasília', () => {
    // pt-BR default de toLocaleString insere vírgula entre data e hora.
    // 2026-08-10T15:00:00Z == 12:00 horário de Brasília (UTC-3)
    const out = formatarDataHoraBrasilia('2026-08-10T15:00:00.000Z');
    expect(out).toMatch(/^\d{2}\/\d{2}\/2026, \d{2}:\d{2}$/);
    expect(out).toBe('10/08/2026, 12:00');
  });

  it('aceita objeto Date', () => {
    const out = formatarDataHoraBrasilia(new Date('2026-01-01T00:00:00.000Z'));
    // 31/12/2025, 21:00 (UTC-3)
    expect(out).toBe('31/12/2025, 21:00');
  });
});

describe('formatarDataExtensoBrasilia', () => {
  it('formata ISO por extenso no fuso de Brasília', () => {
    const out = formatarDataExtensoBrasilia('2026-08-10T15:00:00.000Z');
    expect(out).toBe('10 de agosto de 2026');
  });
});

describe('extrairJPEGsDoPDF', () => {
  // JPEG mínimo: SOI (FF D8) ... payload ... EOI (FF D9)
  function jpeg(size: number): Buffer {
    const body = Buffer.alloc(size, 0xab); // payload qualquer
    return Buffer.concat([Buffer.from([0xff, 0xd8]), body, Buffer.from([0xff, 0xd9])]);
  }

  it('extrai múltiplos JPEGs de um buffer', () => {
    const big1 = jpeg(10_000);
    const big2 = jpeg(8_000);
    const pequeno = jpeg(1_000); // abaixo do threshold de 5KB — deve ser ignorado
    const buf = Buffer.concat([big1, Buffer.from('ruído'), big2, pequeno]);
    const imgs = extrairJPEGsDoPDF(buf);
    expect(imgs).toHaveLength(2);
  });

  it('ignora JPEGs menores que o threshold de 5KB', () => {
    const buf = jpeg(2_000);
    expect(extrairJPEGsDoPDF(buf)).toHaveLength(0);
  });

  it('retorna array vazio se não houver JPEG', () => {
    expect(extrairJPEGsDoPDF(Buffer.from('não é pdf nem imagem'))).toHaveLength(0);
  });

  it('lida com SOI sem EOI (trunca)', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(10_000, 0xcc)]);
    expect(extrairJPEGsDoPDF(buf)).toHaveLength(0);
  });
});
