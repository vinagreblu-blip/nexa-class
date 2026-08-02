import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import { randomInt } from 'node:crypto';
import { getDb } from '../database';
import { IPC_CHANNELS } from '../types';
import type { Aluno, AlunoInput, ApiResult } from '../types';
import { requerAuth, getSessao } from './auth';
import { HISTORICO_PADRAO_HELIOROCHA_ADM, HISTORICO_PADRAO_HELIOROCHA_COM_SOCIAL_PP, HISTORICO_PADRAO_HELIOROCHA_ENG_CIVIL, HISTORICO_PADRAO_HELIOROCHA_ENG_PRODUCAO, HISTORICO_PADRAO_HELIOROCHA_ENG_ELETRICA, HISTORICO_PADRAO_HELIOROCHA_FISIOTERAPIA, HISTORICO_PADRAO_HELIOROCHA_SERVICO_SOCIAL, HISTORICO_PADRAO_HELIOROCHA_SISTEMA_INFORMACAO, HISTORICO_PADRAO_HELIOROCHA_TURISMO, HISTORICO_PADRAO_FACIIP_ADM, HISTORICO_PADRAO_FACIIP_ADM_HOSPITALAR, HISTORICO_PADRAO_FACIIP_COM_SOCIAL_RP, HISTORICO_PADRAO_FACIIP_CONTABEIS, HISTORICO_PADRAO_FACIIP_ENG_PRODUCAO_MEC, HISTORICO_PADRAO_FACIIP_JORNALISMO, HISTORICO_PADRAO_FACIIP_PEDAGOGIA, HISTORICO_PADRAO_FACIIP_TURISMO_HOTELARIA, HISTORICO_PADRAO_FATECE_PEDAGOGIA, HISTORICO_PADRAO_FATECE_TEOLOGIA } from '../historico-template';

// Gera sequência de semestres a partir de um período inicial (ex: "2021.1" → ["2021.1","2021.2","2022.1",...])
function gerarPeriodos(inicio: string, quantidade: number): string[] {
  const m = /^(\d{4})\.(1|2)$/.exec(inicio);
  if (!m) return [];
  let ano = parseInt(m[1]);
  let sem = parseInt(m[2]);
  const out: string[] = [];
  for (let i = 0; i < quantidade; i++) {
    out.push(`${ano}.${sem}`);
    if (sem === 1) { sem = 2; } else { ano++; sem = 1; }
  }
  return out;
}

function popularHistoricoPadrao(
  alunoId: number | bigint,
  template: ReadonlyArray<{ periodo: string; disciplina: string; docente: string; titulacao: string; ch: string; status: string }>,
  anoIngresso: string
): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO historico_disciplinas
     (aluno_id, periodo, disciplina, docente, titulacao, ch, nota, status, ordem)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // Extrai períodos únicos do template (na ordem)
  const periodosTemplate: string[] = [];
  for (const d of template) {
    if (!periodosTemplate.includes(d.periodo)) periodosTemplate.push(d.periodo);
  }

  // Gera novos períodos baseados no ano do vestibular do aluno
  let mapa: Map<string, string>;
  if (anoIngresso && /^\d{4}\.(1|2)$/.test(anoIngresso)) {
    const novos = gerarPeriodos(anoIngresso, periodosTemplate.length);
    mapa = new Map(periodosTemplate.map((old, i) => [old, novos[i] ?? old]));
  } else {
    mapa = new Map(); // sem mapeamento, usa períodos do template
  }

  const ordemPorPeriodo = new Map<string, number>();
  for (const d of template) {
    const periodoFinal = mapa.get(d.periodo) ?? d.periodo;
    const ordem = (ordemPorPeriodo.get(periodoFinal) ?? 0) + 1;
    ordemPorPeriodo.set(periodoFinal, ordem);
    stmt.run(alunoId, periodoFinal, d.disciplina, d.docente, d.titulacao, d.ch, null, d.status, ordem);
  }
}

function gerarMatricula(rg: string, anoIngresso: string): string {
  const digitos = (rg || '').replace(/\D/g, '').split('');
  let amostra = '';
  for (let i = 0; i < 5; i++) {
    if (digitos.length === 0) {
      amostra += randomInt(0, 10).toString();
    } else {
      const idx = randomInt(0, digitos.length);
      amostra += digitos[idx];
      digitos.splice(idx, 1);
    }
  }
  return `${anoIngresso.split('.')[0]}${amostra}`;
}

function listar(_event: IpcMainInvokeEvent, busca?: string, origem?: string): ApiResult<Aluno[]> {
  const db = getDb();
  let rows: Aluno[];

  const baseSelect = `SELECT a.*, u.nome AS created_by_nome, u.codigo AS created_by_codigo
                      FROM alunos a
                      LEFT JOIN usuarios u ON u.id = a.created_by`;

  const origemFilter = origem === 'cursos_livres'
    ? " AND a.origem = 'cursos_livres'"
    : " AND (a.origem IS NULL OR a.origem != 'cursos_livres')";

  if (busca && busca.trim()) {
    const termo = `%${busca.trim()}%`;
    rows = db
      .prepare(
        `${baseSelect}
         WHERE (a.nome LIKE ? OR a.matricula LIKE ? OR a.cpf LIKE ? OR a.rg LIKE ? OR a.curso LIKE ?)${origemFilter}
         ORDER BY a.nome ASC`
      )
      .all(termo, termo, termo, termo, termo) as Aluno[];
  } else {
    rows = db.prepare(`${baseSelect} WHERE 1=1${origemFilter} ORDER BY a.nome ASC`).all() as Aluno[];
  }

  return { ok: true, data: rows };
}

function buscar(_event: IpcMainInvokeEvent, id: number): ApiResult<Aluno> {
  const db = getDb();
  const row = db.prepare('SELECT * FROM alunos WHERE id = ?').get(id) as Aluno | undefined;
  if (!row) return { ok: false, error: 'Aluno não encontrado' };
  return { ok: true, data: row };
}

function validarInput(input: AlunoInput): string | null {
  if (!input.nome?.trim()) return 'Nome é obrigatório';
  if (!input.cpf?.trim()) return 'CPF é obrigatório';
  if (!input.rg?.trim()) return 'RG é obrigatório';
  if (!input.ano_ingresso?.trim()) return 'Ano de ingresso é obrigatório (necessário para gerar a matrícula)';
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    return 'E-mail inválido';
  }
  return null;
}

const COLS_INSERT =
  '(matricula, nome, cpf, rg, nacionalidade, naturalidade, cidade, sexo, orgao_emissor, turno, forma_ingresso, data_vestibular, data_colacao, email, telefone, curso, faculdade, ano_ingresso, ano_conclusao, data_nascimento, created_by, origem)';

function valoresInsert(input: AlunoInput, matricula: string): any[] {
  return [
    matricula,
    input.nome?.trim() || null,
    input.cpf?.trim() || null,
    input.rg?.trim() || null,
    input.nacionalidade?.trim() || null,
    input.naturalidade?.trim() || null,
    input.cidade?.trim() || null,
    input.sexo?.trim() || null,
    input.orgao_emissor?.trim() || null,
    input.turno?.trim() || null,
    input.forma_ingresso?.trim() || null,
    input.data_vestibular?.trim() || null,
    input.data_colacao?.trim() || null,
    input.email?.trim() || null,
    input.telefone?.trim() || null,
    input.curso?.trim() || null,
    input.faculdade?.trim() || null,
    input.ano_ingresso?.trim() || null,
    input.ano_conclusao?.trim() || null,
    input.data_nascimento?.trim() || null,
  ];
}

function criar(_event: IpcMainInvokeEvent, input: AlunoInput): ApiResult<Aluno> {
  const erro = validarInput(input);
  if (erro) return { ok: false, error: erro };

  const db = getDb();
  const placeholders = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';


  for (let tentativa = 0; tentativa < 12; tentativa++) {
    const matricula =
      tentativa === 0 && input.matricula?.trim()
        ? input.matricula.trim()
        : gerarMatricula(input.rg || '', input.ano_ingresso || '');
    try {
      // Transação: INSERT do aluno + popular histórico atômicos.
      // Antes, falha parcial deixava aluno sem histórico (ou histórico órfão se o aluno falhasse depois).
      const row = db.transaction((): Aluno => {
        const info = db
          .prepare(`INSERT INTO alunos ${COLS_INSERT} VALUES ${placeholders}`)
          .run(...valoresInsert(input, matricula), getSessao()?.usuario.id ?? null, input.origem || 'sistema');
        // Popula o histórico padrão automaticamente para Hélio Rocha
        const faculdade = input.faculdade?.trim();
        const curso = input.curso?.trim();
        const vestibular = input.ano_ingresso?.trim() ?? '';
        if (faculdade === 'Hélio Rocha' && curso === 'Administração') {
          popularHistoricoPadrao(info.lastInsertRowid, HISTORICO_PADRAO_HELIOROCHA_ADM, vestibular);
        } else if (faculdade === 'Hélio Rocha' && curso === 'Comunicação Social (Publicidade e Propaganda)') {
          popularHistoricoPadrao(info.lastInsertRowid, HISTORICO_PADRAO_HELIOROCHA_COM_SOCIAL_PP, vestibular);
        } else if (faculdade === 'Hélio Rocha' && curso === 'Engenharia Civil') {
          popularHistoricoPadrao(info.lastInsertRowid, HISTORICO_PADRAO_HELIOROCHA_ENG_CIVIL, vestibular);
        } else if (faculdade === 'Hélio Rocha' && curso === 'Engenharia de Produção') {
          popularHistoricoPadrao(info.lastInsertRowid, HISTORICO_PADRAO_HELIOROCHA_ENG_PRODUCAO, vestibular);
        } else if (faculdade === 'Hélio Rocha' && curso === 'Engenharia Elétrica') {
          popularHistoricoPadrao(info.lastInsertRowid, HISTORICO_PADRAO_HELIOROCHA_ENG_ELETRICA, vestibular);
        } else if (faculdade === 'Hélio Rocha' && curso === 'Fisioterapia') {
          popularHistoricoPadrao(info.lastInsertRowid, HISTORICO_PADRAO_HELIOROCHA_FISIOTERAPIA, vestibular);
        } else if (faculdade === 'Hélio Rocha' && curso === 'Serviço Social') {
          popularHistoricoPadrao(info.lastInsertRowid, HISTORICO_PADRAO_HELIOROCHA_SERVICO_SOCIAL, vestibular);
        } else if (faculdade === 'Hélio Rocha' && curso === 'Sistema de Informação') {
          popularHistoricoPadrao(info.lastInsertRowid, HISTORICO_PADRAO_HELIOROCHA_SISTEMA_INFORMACAO, vestibular);
        } else if (faculdade === 'Hélio Rocha' && curso === 'Turismo') {
          popularHistoricoPadrao(info.lastInsertRowid, HISTORICO_PADRAO_HELIOROCHA_TURISMO, vestibular);
        } else if (faculdade === 'FACIIP' && curso === 'Administração') {
          popularHistoricoPadrao(info.lastInsertRowid, HISTORICO_PADRAO_FACIIP_ADM, vestibular);
        } else if (faculdade === 'FACIIP' && curso === 'Administração Hospitalar') {
          popularHistoricoPadrao(info.lastInsertRowid, HISTORICO_PADRAO_FACIIP_ADM_HOSPITALAR, vestibular);
        } else if (faculdade === 'FACIIP' && curso === 'Comunicação Social (Relações Públicas)') {
          popularHistoricoPadrao(info.lastInsertRowid, HISTORICO_PADRAO_FACIIP_COM_SOCIAL_RP, vestibular);
        } else if (faculdade === 'FACIIP' && curso === 'Ciências Contábeis') {
          popularHistoricoPadrao(info.lastInsertRowid, HISTORICO_PADRAO_FACIIP_CONTABEIS, vestibular);
        } else if (faculdade === 'FACIIP' && curso === 'Engenharia de Produção Mecânica') {
          popularHistoricoPadrao(info.lastInsertRowid, HISTORICO_PADRAO_FACIIP_ENG_PRODUCAO_MEC, vestibular);
        } else if (faculdade === 'FACIIP' && curso === 'Jornalismo') {
          popularHistoricoPadrao(info.lastInsertRowid, HISTORICO_PADRAO_FACIIP_JORNALISMO, vestibular);
        } else if (faculdade === 'FACIIP' && curso === 'Pedagogia') {
          popularHistoricoPadrao(info.lastInsertRowid, HISTORICO_PADRAO_FACIIP_PEDAGOGIA, vestibular);
        } else if (faculdade === 'FACIIP' && curso === 'Turismo e Hotelaria') {
          popularHistoricoPadrao(info.lastInsertRowid, HISTORICO_PADRAO_FACIIP_TURISMO_HOTELARIA, vestibular);
        } else if (faculdade === 'FATECE' && curso === 'Administração') {
          popularHistoricoPadrao(info.lastInsertRowid, HISTORICO_PADRAO_HELIOROCHA_ADM, vestibular);
        } else if (faculdade === 'FATECE' && curso === 'Pedagogia') {
          popularHistoricoPadrao(info.lastInsertRowid, HISTORICO_PADRAO_FATECE_PEDAGOGIA, vestibular);
        } else if (faculdade === 'FATECE' && curso === 'Teologia') {
          popularHistoricoPadrao(info.lastInsertRowid, HISTORICO_PADRAO_FATECE_TEOLOGIA, vestibular);
        }
        return db.prepare('SELECT * FROM alunos WHERE id = ?').get(info.lastInsertRowid) as Aluno;
      });
      return { ok: true, data: row };
    } catch (e: any) {
      if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        continue;
      }
      return { ok: false, error: e?.message ?? 'Erro ao cadastrar aluno' };
    }
  }
  return { ok: false, error: 'Não foi possível gerar uma matrícula única. Tente novamente.' };
}

function atualizar(
  _event: IpcMainInvokeEvent,
  id: number,
  input: AlunoInput
): ApiResult<Aluno> {
  const erro = validarInput(input);
  if (erro) return { ok: false, error: erro };

  const db = getDb();
  try {
    const result = db
      .prepare(
        `UPDATE alunos
         SET matricula = ?, nome = ?, cpf = ?, rg = ?, nacionalidade = ?, naturalidade = ?,
             cidade = ?, sexo = ?, orgao_emissor = ?, turno = ?, forma_ingresso = ?,
             data_vestibular = ?, data_colacao = ?, email = ?, telefone = ?, curso = ?,
             faculdade = ?, ano_ingresso = ?, ano_conclusao = ?, data_nascimento = ?,
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(...valoresInsert(input, input.matricula.trim()), id);

    if (result.changes === 0) return { ok: false, error: 'Aluno não encontrado' };
    const row = db.prepare('SELECT * FROM alunos WHERE id = ?').get(id) as Aluno;
    return { ok: true, data: row };
  } catch (e: any) {
    if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { ok: false, error: 'Já existe um aluno com essa matrícula' };
    }
    return { ok: false, error: e?.message ?? 'Erro ao atualizar aluno' };
  }
}

function excluir(_event: IpcMainInvokeEvent, id: number): ApiResult<true> {
  const db = getDb();
  const decl = db
    .prepare('SELECT COUNT(*) AS total FROM declaracoes WHERE aluno_id = ?')
    .get(id) as { total: number };

  if (decl.total > 0) {
    return {
      ok: false,
      error: `Não é possível excluir: existem ${decl.total} declaração(ões) vinculada(s) a este aluno`,
    };
  }

  const result = db.prepare('DELETE FROM alunos WHERE id = ?').run(id);
  if (result.changes === 0) return { ok: false, error: 'Aluno não encontrado' };
  return { ok: true, data: true };
}

export function registrarAlunosHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ALUNO_LISTAR, requerAuth(listar));
  ipcMain.handle(IPC_CHANNELS.ALUNO_BUSCAR, requerAuth(buscar));
  ipcMain.handle(IPC_CHANNELS.ALUNO_CRIAR, requerAuth(criar));
  ipcMain.handle(IPC_CHANNELS.ALUNO_ATUALIZAR, requerAuth(atualizar));
  ipcMain.handle(IPC_CHANNELS.ALUNO_EXCLUIR, requerAuth(excluir));
}
