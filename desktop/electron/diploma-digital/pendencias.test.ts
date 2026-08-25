import { describe, expect, it } from 'vitest';
import {
  normalizarCpf,
  normalizarCnpj,
  normalizarCep,
  normalizarData,
  normalizarSexo,
  normalizarRg,
  normalizarUf,
  normalizarCargaHoraria,
  normalizarNota,
} from './normalizadores';
import { verificarPendenciasDiploma } from './pendencias';

// ---------- normalizadores ----------

describe('normalizarCpf (TCpf [0-9]{11})', () => {
  it('remove pontuação de CPF válido', () => expect(normalizarCpf('123.456.789-00')).toBe('12345678900'));
  it('rejeita CPF com menos de 11 dígitos', () => expect(normalizarCpf('123.456.789')).toBeNull());
  it('rejeita vazio/nulo', () => {
    expect(normalizarCpf('')).toBeNull();
    expect(normalizarCpf(null)).toBeNull();
  });
});

describe('normalizarCnpj (TCnpj [0-9]{14})', () => {
  it('remove pontuação', () => expect(normalizarCnpj('03.466.601/0001-82')).toBe('03466601000182'));
  it('rejeita tamanho errado', () => expect(normalizarCnpj('034666010001')).toBeNull());
});

describe('normalizarCep', () => {
  it('aceita 40000-000', () => expect(normalizarCep('40.000-000')).toBe('40000000'));
  it('rejeita 7 dígitos', () => expect(normalizarCep('4000000')).toBeNull());
});

describe('normalizarData (TData AAAA-MM-DD)', () => {
  it('aceita ISO com hora', () => expect(normalizarData('2026-08-25T10:00:00Z')).toBe('2026-08-25'));
  it('converte DD/MM/AAAA', () => expect(normalizarData('25/08/2026')).toBe('2026-08-25'));
  it('converte DD/MM/AA', () => expect(normalizarData('25/08/26')).toBe('2026-08-25'));
  it('rejeita formato desconhecido', () => {
    expect(normalizarData('25-08-2026')).toBeNull();
    expect(normalizarData('Cursando')).toBeNull();
    expect(normalizarData('')).toBeNull();
  });
});

describe('normalizarSexo (TSexo M|F)', () => {
  it('normaliza variações', () => {
    expect(normalizarSexo('Masculino')).toBe('M');
    expect(normalizarSexo('f')).toBe('F');
    expect(normalizarSexo('Feminino')).toBe('F');
  });
  it('rejeita indefinido', () => {
    expect(normalizarSexo('X')).toBeNull();
    expect(normalizarSexo(null)).toBeNull();
  });
});

describe('normalizarRg (TNumeroRg 4-15 alfanuméricos)', () => {
  it('limpa pontuação', () => expect(normalizarRg('1.234.567')).toBe('1234567'));
  it('rejeita curto demais', () => expect(normalizarRg('12')).toBeNull());
});

describe('normalizarUf (TUf enum)', () => {
  it('aceita sigla válida em minúsculo', () => expect(normalizarUf('ba')).toBe('BA'));
  it('rejeita sigla inexistente', () => expect(normalizarUf('XX')).toBeNull());
});

describe('normalizarCargaHoraria (TCargaHoraria XSD)', () => {
  it('"80H" → HoraAula 80', () => expect(normalizarCargaHoraria('80H')).toEqual({ horaAula: 80 }));
  it('"80" → HoraAula 80 (sem unidade)', () => expect(normalizarCargaHoraria('80')).toEqual({ horaAula: 80 }));
  it('"80,5 HR" → HoraRelogio 80.5', () => expect(normalizarCargaHoraria('80,5 HR')).toEqual({ horaRelogio: 80.5 }));
  it('sem número → null', () => {
    expect(normalizarCargaHoraria('—')).toBeNull();
    expect(normalizarCargaHoraria('')).toBeNull();
  });
});

describe('normalizarNota (TNota 0-10 / TConceito)', () => {
  it('"9,5" → nota 9.5', () => expect(normalizarNota('9,5')).toEqual({ nota: 9.5 }));
  it('"AP" não é nota nem conceito do XSD → null', () => expect(normalizarNota('AP')).toBeNull());
  it('"A" → conceito', () => expect(normalizarNota('A')).toEqual({ conceito: 'A' }));
  it('nota > 10 → null', () => expect(normalizarNota('11')).toBeNull());
});

// ---------- pendências (cenários exigidos: 1-6 do item 28) ----------

/** DB fake em memória com as tabelas/consultas usadas por verificarPendenciasDiploma. */
function dbFake({ aluno, curso, ies }: { aluno: any; curso?: any; ies?: any }) {
  // Espelha os aliases do SELECT real (i.credenciamento_json AS ies_credenciamento etc.)
  const comIes = (c: any) =>
    ies
      ? {
          ...c,
          ies_codigo_emec: ies.codigo_emec,
          ies_cnpj: ies.cnpj,
          ies_logradouro: ies.logradouro,
          ies_bairro: ies.bairro,
          ies_codigo_municipio: ies.codigo_municipio,
          ies_uf: ies.uf,
          ies_cep: ies.cep,
          ies_credenciamento: ies.credenciamento_json,
        }
      : undefined;
  return {
    prepare(sql: string) {
      return {
        get: (...args: any[]) => {
          if (sql.startsWith('SELECT * FROM alunos')) return args[0] === aluno?.id ? aluno : undefined;
          if (sql.includes('FROM cursos c JOIN ies i')) return curso && ies ? comIes(curso) : undefined;
          if (sql.includes('SELECT id FROM cursos')) return curso;
          if (sql.includes("SELECT id FROM ies WHERE papel = 'emissora'")) return ies;
          return undefined;
        },
      };
    },
  };
}

const IES_COMPLETA = {
  id: 1, nome: 'INSTITUTO ERICH FROMM', codigo_emec: 1234, cnpj: '03466601000182',
  logradouro: 'Rua A', bairro: 'Centro', codigo_municipio: '2927408', uf: 'BA', cep: '40000000',
  credenciamento_json: '{"tipo":"Portaria","numero":"100","data":"2010-01-01"}',
};

const CURSO_COMPLETO = {
  id: 1, nome: 'ADMINISTRAÇÃO', codigo_emec: 106513, modalidade: 'Presencial',
  titulo_conferido: 'Bacharel', grau_conferido: 'Bacharelado',
  autorizacao_json: '{"tipo":"Portaria","numero":"10","data":"2010-01-01"}',
  reconhecimento_json: '{"tipo":"Portaria","numero":"20","data":"2015-01-01"}',
};

const ALUNO_COMPLETO = {
  id: 1, nome: 'MARIA DA SILVA', matricula: '12345', cpf: '123.456.789-00', sexo: 'F',
  nacionalidade: 'Brasileira', naturalidade: 'Salvador', naturalidade_codigo_ibge: '2927408',
  naturalidade_uf: 'BA', rg: '1.234.567', rg_uf: 'BA', data_nascimento: '2000-05-10',
  curso: 'ADMINISTRAÇÃO', ano_conclusao: '2024', data_colacao: '20/12/2024',
};

describe('verificarPendenciasDiploma', () => {
  it('aluno completo com curso/IES completos → ZERO pendências', () => {
    const db = dbFake({ aluno: ALUNO_COMPLETO, curso: CURSO_COMPLETO, ies: IES_COMPLETA });
    expect(verificarPendenciasDiploma(db as any, 1)).toEqual([]);
  });

  it('aluno inexistente → pendência de aluno', () => {
    const db = dbFake({ aluno: undefined });
    const p = verificarPendenciasDiploma(db as any, 99);
    expect(p).toHaveLength(1);
    expect(p[0].campo).toBe('Aluno');
  });

  it('aluno sem CPF → pendência Diplomado.CPF', () => {
    const db = dbFake({ aluno: { ...ALUNO_COMPLETO, cpf: null }, curso: CURSO_COMPLETO, ies: IES_COMPLETA });
    const p = verificarPendenciasDiploma(db as any, 1);
    expect(p.some((x) => x.elementoXml === 'Diplomado.CPF')).toBe(true);
  });

  it('CPF inválido (poucos dígitos) → pendência', () => {
    const db = dbFake({ aluno: { ...ALUNO_COMPLETO, cpf: '123' }, curso: CURSO_COMPLETO, ies: IES_COMPLETA });
    expect(verificarPendenciasDiploma(db as any, 1).some((x) => x.elementoXml === 'Diplomado.CPF')).toBe(true);
  });

  it('aluno ainda cursando → pendência de conclusão', () => {
    const db = dbFake({ aluno: { ...ALUNO_COMPLETO, ano_conclusao: 'Cursando' }, curso: CURSO_COMPLETO, ies: IES_COMPLETA });
    const p = verificarPendenciasDiploma(db as any, 1);
    expect(p.some((x) => x.elementoXml === 'DadosDiploma.DataConclusao')).toBe(true);
  });

  it('sem data de colação → pendência DataColacaoGrau', () => {
    const db = dbFake({ aluno: { ...ALUNO_COMPLETO, data_colacao: null }, curso: CURSO_COMPLETO, ies: IES_COMPLETA });
    expect(verificarPendenciasDiploma(db as any, 1).some((x) => x.elementoXml.includes('DataColacaoGrau'))).toBe(true);
  });

  it('sem curso vinculado → pendência de curso', () => {
    const db = dbFake({ aluno: { ...ALUNO_COMPLETO, curso: null }, curso: CURSO_COMPLETO, ies: IES_COMPLETA });
    expect(verificarPendenciasDiploma(db as any, 1).some((x) => x.elementoXml === 'DadosCurso.NomeCurso')).toBe(true);
  });

  it('curso não cadastrado institucionalmente → pendência com orientação', () => {
    const db = dbFake({ aluno: ALUNO_COMPLETO, curso: undefined, ies: IES_COMPLETA });
    const p = verificarPendenciasDiploma(db as any, 1);
    const c = p.find((x) => x.origem === 'cursos (cadastro institucional)');
    expect(c).toBeTruthy();
    expect(c?.comoObter).toMatch(/Cadastro Institucional/);
  });

  it('curso sem e-MEC / atos → pendências de DadosCurso', () => {
    const cursoIncompleto = { nome: 'ADMINISTRAÇÃO' };
    const db = dbFake({ aluno: ALUNO_COMPLETO, curso: cursoIncompleto, ies: IES_COMPLETA });
    const p = verificarPendenciasDiploma(db as any, 1);
    expect(p.some((x) => x.elementoXml === 'DadosCurso.CodigoCursoEMEC')).toBe(true);
    expect(p.some((x) => x.elementoXml === 'DadosCurso.Autorizacao')).toBe(true);
    expect(p.some((x) => x.elementoXml === 'DadosCurso.Reconhecimento')).toBe(true);
  });

  it('IES sem e-MEC/CNPJ/credenciamento/endereço → pendências de IesEmissora', () => {
    const iesIncompleta = { id: 1, nome: 'IES X', credenciamento_json: null };
    const db = dbFake({ aluno: ALUNO_COMPLETO, curso: CURSO_COMPLETO, ies: iesIncompleta });
    const p = verificarPendenciasDiploma(db as any, 1);
    expect(p.some((x) => x.elementoXml === 'IesEmissora.CodigoMEC')).toBe(true);
    expect(p.some((x) => x.elementoXml === 'IesEmissora.CNPJ')).toBe(true);
    expect(p.some((x) => x.elementoXml === 'IesEmissora.Credenciamento')).toBe(true);
    expect(p.some((x) => x.elementoXml === 'IesEmissora.Endereco')).toBe(true);
  });

  it('RG sem UF → pendência Diplomado.RG (exigência do XSD)', () => {
    const db = dbFake({ aluno: { ...ALUNO_COMPLETO, rg_uf: null }, curso: CURSO_COMPLETO, ies: IES_COMPLETA });
    expect(verificarPendenciasDiploma(db as any, 1).some((x) => x.elementoXml === 'Diplomado.RG')).toBe(true);
  });

  it('naturalidade estrangeira dispensa código IBGE', () => {
    const db = dbFake({
      aluno: { ...ALUNO_COMPLETO, naturalidade_estrangeira: 'Lisboa', naturalidade_codigo_ibge: null, naturalidade_uf: null },
      curso: CURSO_COMPLETO,
      ies: IES_COMPLETA,
    });
    expect(verificarPendenciasDiploma(db as any, 1).some((x) => x.elementoXml.includes('Naturalidade'))).toBe(false);
  });
});
