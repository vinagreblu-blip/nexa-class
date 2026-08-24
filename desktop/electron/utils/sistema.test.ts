import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  calcularTamanhoDiretorio,
  sanitizarParaArquivo,
  montarNomePdf,
  montarNomeArquivo,
  gravarArquivoSeguro,
} from './sistema';

/**
 * Testes dos helpers de filesystem/sistema — todos puros (sem Electron/DB).
 */

describe('calcularTamanhoDiretorio', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `nexa-dash-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignora */
    }
  });

  it('retorna 0 para diretório inexistente', () => {
    expect(calcularTamanhoDiretorio(path.join(tmpDir, 'nao-existe'))).toBe(0);
  });

  it('retorna 0 para diretório vazio', () => {
    expect(calcularTamanhoDiretorio(tmpDir)).toBe(0);
  });

  it('soma tamanho de um único arquivo', () => {
    const conteudo = 'a'.repeat(1000);
    fs.writeFileSync(path.join(tmpDir, 'arquivo.txt'), conteudo);
    expect(calcularTamanhoDiretorio(tmpDir)).toBeGreaterThanOrEqual(1000);
  });

  it('soma tamanhos de múltiplos arquivos', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'x'.repeat(500));
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'y'.repeat(300));
    expect(calcularTamanhoDiretorio(tmpDir)).toBeGreaterThanOrEqual(800);
  });

  it('recursivo: soma arquivos em subdiretórios', () => {
    fs.writeFileSync(path.join(tmpDir, 'raiz.txt'), 'x'.repeat(100));
    const sub = path.join(tmpDir, 'sub');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'filho.txt'), 'y'.repeat(200));
    const outroSub = path.join(sub, 'outro');
    fs.mkdirSync(outroSub);
    fs.writeFileSync(path.join(outroSub, 'neto.txt'), 'z'.repeat(50));
    expect(calcularTamanhoDiretorio(tmpDir)).toBeGreaterThanOrEqual(350);
  });

  it('não lança para diretório com permissões restritas', () => {
    expect(() => calcularTamanhoDiretorio(tmpDir)).not.toThrow();
  });
});

describe('sanitizarParaArquivo', () => {
  it('remove acentos e converte para lowercase', () => {
    expect(sanitizarParaArquivo('João da Silva')).toBe('joao-da-silva');
    expect(sanitizarParaArquivo('ANA Beatriz ÇÔÊ')).toBe('ana-beatriz-coe');
    expect(sanitizarParaArquivo('JOSÉ')).toBe('jose');
  });

  it('espaços viram hifens', () => {
    expect(sanitizarParaArquivo('Maria Beatriz Santos')).toBe('maria-beatriz-santos');
    expect(sanitizarParaArquivo('joao   silva')).toBe('joao-silva');
  });

  it('remove caracteres especiais mantendo a-z 0-9 -', () => {
    expect(sanitizarParaArquivo('Aluno (Especial) #2')).toBe('aluno-especial-2');
    // Cião_123! → NFD remove til → "ciao_123!" → remove especial → "ciao123"
    expect(sanitizarParaArquivo('Cião_123!')).toBe('ciao123');
    // # é removido após espaços→hifens, então "Silva#1" vira "silva1" sem separador
    expect(sanitizarParaArquivo('José Silva#1')).toBe('jose-silva1');
  });

  it('colapsa hifens consecutivos e remove das bordas', () => {
    expect(sanitizarParaArquivo('--- João --- Silva ---')).toBe('joao-silva');
    expect(sanitizarParaArquivo('  -  Nome  -  ')).toBe('nome');
  });

  it('trunca em maxLen (default 40)', () => {
    const longo = 'a'.repeat(60);
    const out = sanitizarParaArquivo(longo);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(sanitizarParaArquivo('b'.repeat(60), 10).length).toBeLessThanOrEqual(10);
  });

  it('retorna fallback "aluno" para string vazia ou null', () => {
    expect(sanitizarParaArquivo('')).toBe('aluno');
    expect(sanitizarParaArquivo(null)).toBe('aluno');
    expect(sanitizarParaArquivo(undefined)).toBe('aluno');
    expect(sanitizarParaArquivo('   ')).toBe('aluno');
  });

  it('lida com nomes com números', () => {
    expect(sanitizarParaArquivo('Aluno 3 Ano 2026')).toBe('aluno-3-ano-2026');
  });

  it('fallback "aluno" quando resultado após sanitização é vazio', () => {
    expect(sanitizarParaArquivo('!@#$%')).toBe('aluno');
    expect(sanitizarParaArquivo('---')).toBe('aluno');
  });
});

describe('montarNomePdf', () => {
  it('gera nome padronizado com prefixo-nome-matricula-sufixo.pdf', () => {
    expect(montarNomePdf('diploma', 'João da Silva', '2024001', 5)).toBe(
      'diploma-joao-da-silva-2024001-5.pdf'
    );
  });

  it('usa fallback "aluno" quando nome ausente', () => {
    expect(montarNomePdf('declaracao', null, '2024001', 1)).toBe(
      'declaracao-aluno-2024001-1.pdf'
    );
  });

  it('usa fallback quando matrícula ausente', () => {
    expect(montarNomePdf('historico', 'Ana', null, 99)).toBe('historico-ana-aluno-99.pdf');
  });

  it('sanitiza nome com acentos', () => {
    expect(montarNomePdf('ata-colacao', 'Josi Gonçalves', '2024', 10)).toBe(
      'ata-colacao-josi-goncalves-2024-10.pdf'
    );
  });
});

describe('montarNomeArquivo', () => {
  it('suporta extensão customizada (xml)', () => {
    expect(montarNomeArquivo('historico', 'João', '2024001', 1, 'xml')).toBe(
      'historico-joao-2024001-1.xml'
    );
  });

  it('normaliza extensão com ou sem ponto', () => {
    expect(montarNomeArquivo('historico', 'X', '1', 1, '.xml')).toBe('historico-x-1-1.xml');
  });
});

describe('gravarArquivoSeguro', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `nexa-gravar-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignora */
    }
  });

  it('grava no destino quando ele é gravável', () => {
    const destino = path.join(tmpDir, 'arquivo.xml');
    const res = gravarArquivoSeguro(destino, '<x>ok</x>', path.join(tmpDir, 'fallback'));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.usouFallback).toBe(false);
      expect(res.caminho).toBe(destino);
    }
    expect(fs.readFileSync(destino, 'utf8')).toBe('<x>ok</x>');
  });

  it('usa fallback quando o destino está bloqueado (caminho inválido)', () => {
    // Unidade inexistente: writeFileSync falha sempre, independente de permissões
    const destino = path.join('\\\\?\\Z:\\nexa-inexistente\\arquivo.xml');
    const fallbackDir = path.join(tmpDir, 'fallback');
    const res = gravarArquivoSeguro(destino, '<x>fb</x>', fallbackDir, 'nome-fb.xml');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.usouFallback).toBe(true);
      expect(res.caminho).toBe(path.join(fallbackDir, 'nome-fb.xml'));
    }
    expect(fs.readFileSync(path.join(fallbackDir, 'nome-fb.xml'), 'utf8')).toBe('<x>fb</x>');
  });

  it('usa basename do destino como nome do fallback quando não informado', () => {
    const destino = path.join('\\\\?\\Z:\\nexa-inexistente\\sem-nome.xml');
    const fallbackDir = path.join(tmpDir, 'fb2');
    const res = gravarArquivoSeguro(destino, 'conteudo', fallbackDir);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.caminho).toBe(path.join(fallbackDir, 'sem-nome.xml'));
  });

  it('retorna erro descritivo quando destino e fallback falham', () => {
    const destino = path.join('\\\\?\\Z:\\nexa-inexistente\\arquivo.xml');
    const res = gravarArquivoSeguro(destino, 'x', path.join('\\\\?\\Z:\\nexa-inexistente\\fb'));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.erro).toContain('Falha ao gravar');
    }
  });
});
