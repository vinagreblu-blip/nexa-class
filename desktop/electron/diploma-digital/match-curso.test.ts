import { describe, expect, it } from 'vitest';
import { encontrarCursoPorNome, normalizarNomeCurso } from './match-curso';

// ============================================================
// Matching aluno↔curso por nome — helper único compartilhado por
// pendencias.ts, coletor.ts e ipc/diplomas-digitais.ts.
// ============================================================

describe('normalizarNomeCurso', () => {
  it('remove acentos, minúsculas e espaços das pontas', () => {
    expect(normalizarNomeCurso('  ADMINISTRAÇÃO ')).toBe('administracao');
  });
  it('normaliza cedilha e maiúsculas acentuadas', () => {
    expect(normalizarNomeCurso('ENGENHARIA DE PRODUÇÃO MECÂNICA')).toBe(
      'engenharia de producao mecanica'
    );
  });
  it('null/undefined/vazio → string vazia', () => {
    expect(normalizarNomeCurso(null)).toBe('');
    expect(normalizarNomeCurso(undefined)).toBe('');
    expect(normalizarNomeCurso('')).toBe('');
  });
});

describe('encontrarCursoPorNome', () => {
  const cursos = [
    { id: 1, nome: 'Administração' },
    { id: 2, nome: 'Sistema de Informação' },
    { id: 3, nome: 'Engenharia de Produção Mecânica' },
  ];

  it('casa ignorando acentos e caixa (aluno sem acento ↔ curso acentuado)', () => {
    expect(encontrarCursoPorNome(cursos, 'ADMINISTRACAO')?.id).toBe(1);
    expect(encontrarCursoPorNome(cursos, 'sistema de informacao')?.id).toBe(2);
    expect(encontrarCursoPorNome(cursos, '  ENGENHARIA DE PRODUCAO MECANICA ')?.id).toBe(3);
  });
  it('plural NÃO casa (nome oficial precisa bater exato)', () => {
    expect(encontrarCursoPorNome(cursos, 'Sistemas de Informação')).toBeUndefined();
  });
  it('nome vazio/nulo → undefined (não inventa curso)', () => {
    expect(encontrarCursoPorNome(cursos, '')).toBeUndefined();
    expect(encontrarCursoPorNome(cursos, null)).toBeUndefined();
    expect(encontrarCursoPorNome(cursos, undefined)).toBeUndefined();
  });
  it('curso com nome NULL no cadastro não casa nem quebra', () => {
    expect(encontrarCursoPorNome([{ id: 9, nome: null }], 'qualquer')).toBeUndefined();
  });
});
