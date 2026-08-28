// ============================================================
// COLETA DE DADOS — banco → snapshot normalizado p/ geradores
// ============================================================
// Centraliza a leitura (adapter db injetável). Os geradores são
// funções puras sobre o snapshot — testáveis com fixtures.
// Pendências específicas de artefato são coletadas aqui (nunca
// inventam dado): filiação (DA), CH do curso, forma de acesso,
// titulação de docente, documentação comprobatória.
import {
  normalizarData, normalizarSexo, normalizarCargaHoraria,
} from './normalizadores';
import { mapearTitulacao, mapearFormaAcesso } from './mapeamento-campos';
import type { PendenciaDiploma } from './pendencias';

export interface AdapterDb {
  prepare(sql: string): { all: (...a: any[]) => any[]; get: (...a: any[]) => any };
}

export class ErroPendenciasXml extends Error {
  pendencias: PendenciaDiploma[];
  constructor(pends: PendenciaDiploma[]) {
    super(`${pends.length} pendência(s) impedem a geração do XML`);
    this.pendencias = pends;
  }
}

export interface SnapshotDiploma {
  processo: any;
  aluno: any;
  curso: any;
  ies: any;
  disciplinas: any[];
}

export function coletarSnapshot(db: AdapterDb, diplomaId: number): SnapshotDiploma | null {
  const processo = db
    .prepare(
      `SELECT dd.*, a.id AS _aluno FROM diplomas_digitais dd JOIN alunos a ON a.id = dd.aluno_id WHERE dd.id = ?`
    )
    .get(diplomaId) as any;
  if (!processo) return null;
  const aluno = db.prepare('SELECT * FROM alunos WHERE id = ?').get(processo.aluno_id) as any;
  // Match do curso: normaliza ACENTOS (LOWER() do SQLite não remove) e
  // case — "ADMINISTRACAO" deve casar com "ADMINISTRAÇÃO"
  const curso = aluno?.curso
    ? (db.prepare(`
        SELECT * FROM cursos
        WHERE LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
          REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
          LOWER(nome),
          'á','a'),('à','a'),('ã','a'),('â','a'),('é','e'),('ê','e'),('í','i'),('ó','o'),('ô','o'),('õ','o'),('ú','u'),('ç','c'),
          ('Á','a'),('À','a'),('Ã','a'),('Â','a'),('É','e'),('Ê','e'),('Í','i'),('Ó','o'),('Ô','o'),('Õ','o'),('Ú','u'),('Ç','c'))
        = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
          REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
          LOWER(?),
          'á','a'),('à','a'),('ã','a'),('â','a'),('é','e'),('ê','e'),('í','i'),('ó','o'),('ô','o'),('õ','o'),('ú','u'),('ç','c'),
          ('Á','a'),('À','a'),('Ã','a'),('Â','a'),('É','e'),('Ê','e'),('Í','i'),('Ó','o'),('Ô','o'),('Õ','o'),('Ú','u'),('Ç','c'))
        AND ativo = 1 ORDER BY id LIMIT 1`).get(aluno.curso) as any)
    : undefined;
  const ies = db.prepare('SELECT * FROM ies WHERE id = ?').get(processo.ies_emissora_id) as any;
  const disciplinas = db
    .prepare('SELECT * FROM historico_disciplinas WHERE aluno_id = ? ORDER BY periodo, ordem, id')
    .all(processo.aluno_id);
  return { processo, aluno, curso, ies, disciplinas };
}

/** Pendências específicas da geração do HISTÓRICO ESCOLAR DIGITAL. */
export function pendenciasHistorico(s: SnapshotDiploma): PendenciaDiploma[] {
  const p: PendenciaDiploma[] = [];
  if (s.disciplinas.length === 0) {
    p.push({
      campo: 'Histórico acadêmico', elementoXml: 'HistoricoEscolar.ElementosHistorico',
      origem: 'historico_disciplinas', motivo: 'aluno sem disciplinas lançadas',
      comoObter: 'Lance o histórico acadêmico do aluno (Histórico Acadêmico → aluno → disciplinas).',
    });
  }
  // Linhas ilegíveis não podem ser descartadas em silêncio pelo gerador —
  // viram pendência com a disciplina exata (CH e nota).
  const chInvalidas = s.disciplinas.filter((d) => !normalizarCargaHoraria(d.ch));
  for (const d of chInvalidas.slice(0, 5)) {
    p.push({
      campo: `Carga horária da disciplina "${d.disciplina}"`,
      elementoXml: 'ElementosHistorico.Disciplina.CargaHoraria',
      origem: 'historico_disciplinas.ch',
      motivo: !d.ch ? 'não cadastrada' : `"${d.ch}" não reconhecida (ex.: 80, 80H, 80:30)`,
      comoObter: 'Corrija a carga horária da disciplina no histórico acadêmico.',
    });
  }
  let aprovadas = 0;
  for (const d of s.disciplinas) {
    const ch = normalizarCargaHoraria(d.ch);
    const status = (d.status ?? '').trim().toUpperCase();
    const ehAprovada = status === 'AP' || status === 'CUMP' || status === 'APROVADO' || status === 'APROVADA' || status === 'CUMPRIDA';
    if (ch && ehAprovada) aprovadas++;
  }
  if (s.disciplinas.length > 0 && aprovadas === 0) {
    p.push({
      campo: 'Carga horária integralizada', elementoXml: 'HistoricoEscolar.CargaHorariaCursoIntegralizada',
      origem: 'historico_disciplinas.status',
      motivo: 'nenhuma disciplina aprovada — o XSD exige CH integralizada > 0',
      comoObter: 'Confirme os status das disciplinas (AP/CUMP para aprovadas).',
    });
  }
  const chCurso = normalizarCargaHoraria(s.curso?.carga_horaria);
  if (!chCurso) {
    p.push({
      campo: 'Carga horária total do curso', elementoXml: 'HistoricoEscolar.CargaHorariaCurso',
      origem: 'cursos.carga_horaria', motivo: !s.curso?.carga_horaria ? 'não cadastrada' : 'formato não reconhecido (ex.: 3000)',
      comoObter: 'Informe a carga horária total do curso no Cadastro Institucional.',
    });
  }
  const forma = mapearFormaAcesso(s.aluno?.forma_ingresso);
  if (!forma) {
    p.push({
      campo: 'Forma de acesso ao curso', elementoXml: 'HistoricoEscolar.IngressoCurso.FormaAcesso',
      origem: 'alunos.forma_ingresso',
      motivo: !s.aluno?.forma_ingresso ? 'não cadastrada' : `"${s.aluno.forma_ingresso}" fora da enumeração do MEC (Vestibular, Enem, …)`,
      comoObter: 'Informe a forma de ingresso com uma das opções do Censo (ex.: Vestibular, Enem).',
    });
  }
  const ingresso =
    normalizarData(s.aluno?.data_vestibular) ??
    (s.aluno?.ano_ingresso && /^\d{4}$/.test(s.aluno.ano_ingresso) ? `${s.aluno.ano_ingresso}-01-01` : null);
  if (!ingresso) {
    p.push({
      campo: 'Data de ingresso', elementoXml: 'HistoricoEscolar.IngressoCurso.Data',
      origem: 'alunos.data_vestibular / ano_ingresso',
      motivo: 'nem data de vestibular nem ano de ingresso cadastrados',
      comoObter: 'Informe a data do vestibular (ou o ano de ingresso) no cadastro do aluno.',
    });
  }
  // Docentes: titulação precisa mapear para o enum TTitulacao; XSD exige ≥1 docente por disciplina
  const usados = new Map<string, string | null>();
  let semDocente = 0;
  for (const d of s.disciplinas) {
    if (!d.docente) { semDocente++; continue; }
    const t = mapearTitulacao(d.titulacao);
    if (t == null && !usados.has(d.docente)) usados.set(d.docente, d.titulacao ?? '');
  }
  if (semDocente > 0) {
    p.push({
      campo: 'Docente(s) da disciplina', elementoXml: 'ElementosHistorico.Disciplina.Docentes',
      origem: 'historico_disciplinas.docente',
      motivo: `${semDocente} disciplina(s) sem docente informado (o XSD exige ≥1 docente por entrada)`,
      comoObter: 'Informe o docente (e a titulação) de todas as disciplinas do histórico.',
    });
  }
  for (const [docente, tit] of usados) {
    p.push({
      campo: `Titulação do docente ${docente}`, elementoXml: 'ElementosHistorico.Disciplina.Docentes.Docente.Titulacao',
      origem: 'historico_disciplinas.titulacao',
      motivo: !tit ? 'não cadastrada' : `"${tit}" fora da enumeração (Tecnólogo, Graduação, Especialização, Mestrado, Doutorado)`,
      comoObter: 'Corrija a titulação do docente no histórico (ou no cadastro de Docentes).',
    });
  }
  return p;
}

/** Pendências específicas da DA (Requerimento de Registro). */
export function pendenciasDA(db: AdapterDb, s: SnapshotDiploma): PendenciaDiploma[] {
  const p: PendenciaDiploma[] = pendenciasHistorico(s);
  // Filiacao: ≥ 1 Genitor com Nome + Sexo
  const genitor = (nome: string | null | undefined, sexo: string | null | undefined) =>
    nome && normalizarSexo(sexo);
  if (!genitor(s.aluno?.mae_nome, s.aluno?.mae_sexo) && !genitor(s.aluno?.pai_nome, s.aluno?.pai_sexo)) {
    p.push({
      campo: 'Filiação (genitor(a))', elementoXml: 'DadosPrivadosDiplomado.Filiacao.Genitor',
      origem: 'alunos.mae_nome/mae_sexo/pai_nome/pai_sexo',
      motivo: 'nenhum genitor com nome E sexo (M/F) cadastrado',
      comoObter: 'Informe o nome e o sexo da mãe e/ou do pai no cadastro do aluno (exigência do XSD da DA).',
    });
  }
  // Documentação comprobatória: ≥ 1 documento ANEXADO E EXISTENTE EM DISCO
  const docs = db
    .prepare('SELECT * FROM aluno_documentos WHERE aluno_id = ? AND caminho IS NOT NULL')
    .all(s.aluno.id) as any[];
  const docsInexistentes = docs.filter((d) => {
    try { return !require('node:fs').existsSync(d.caminho); } catch { return true; }
  });
  if (docs.length === 0) {
    p.push({
      campo: 'Documentação comprobatória', elementoXml: 'RegistroReq.DocumentacaoComprobatoria.Documento',
      origem: 'aluno_documentos',
      motivo: 'nenhum documento anexado ao aluno (PDF embutido no XML)',
      comoObter: 'Anexe ao aluno ao menos um documento (ex.: documento de identidade) em Alunos → Documentos.',
    });
  } else if (docsInexistentes.length === docs.length) {
    p.push({
      campo: 'Documentação comprobatória', elementoXml: 'RegistroReq.DocumentacaoComprobatoria.Documento',
      origem: 'aluno_documentos.caminho',
      motivo: `${docs.length} documento(s) registrado(s) mas NENHUM arquivo existe em disco — reanexe os arquivos em Alunos → Documentos`,
      comoObter: 'Reanexe os documentos do aluno (os arquivos foram movidos ou apagados do disco).',
    });
  }
  return p;
}
