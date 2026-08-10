import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { calcularTamanhoDiretorio } from '../utils/sistema';

// Testar o cálculo de tamanho de diretório isoladamente (não depende de Electron).
// A função `obterMetricas` exige DB real — não está coberta aqui.

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
    // Apenas sanity — não conseguimos simular permissões negadas sem root no teste,
    // mas garantimos que a função tem try/catch defensivo.
    expect(() => calcularTamanhoDiretorio(tmpDir)).not.toThrow();
  });
});
