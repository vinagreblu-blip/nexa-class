import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import bcrypt from 'bcryptjs';
import { getDb } from '../database';
import { CONFIG } from '../config';
import { IPC_CHANNELS } from '../types';
import type { ApiResult } from '../types';
import { requerAuth } from './auth';

export interface CursoLivre {
  id: number;
  nome: string;
  descricao: string | null;
  carga_horaria: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  ativo: number;
  created_at: string;
  updated_at: string;
}

function verificar(_event: IpcMainInvokeEvent, senha: string): ApiResult<true> {
  if (!bcrypt.compareSync(senha ?? '', CONFIG.SENHA_EXCLUSAO_DECLARACAO_HASH)) {
    return { ok: false, error: 'Senha incorreta' };
  }
  return { ok: true, data: true };
}

function listar(_event: IpcMainInvokeEvent, busca?: string): ApiResult<CursoLivre[]> {
  const db = getDb();
  const rows =
    busca
      ? db
          .prepare(
            `SELECT * FROM cursos_livres WHERE nome LIKE ? OR descricao LIKE ? ORDER BY ativo DESC, nome ASC`
          )
          .all(`%${busca}%`, `%${busca}%`) as CursoLivre[]
      : db
          .prepare(`SELECT * FROM cursos_livres ORDER BY ativo DESC, nome ASC`)
          .all() as CursoLivre[];
  return { ok: true, data: rows };
}

function criar(
  _event: IpcMainInvokeEvent,
  input: { nome: string; descricao?: string; carga_horaria?: string; data_inicio?: string; data_fim?: string }
): ApiResult<CursoLivre> {
  if (!input.nome?.trim()) return { ok: false, error: 'Nome é obrigatório' };
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO cursos_livres (nome, descricao, carga_horaria, data_inicio, data_fim) VALUES (?, ?, ?, ?, ?)`
    )
    .run(input.nome.trim(), input.descricao?.trim() || null, input.carga_horaria?.trim() || null, input.data_inicio || null, input.data_fim || null);
  const row = db.prepare('SELECT * FROM cursos_livres WHERE id = ?').get(info.lastInsertRowid) as CursoLivre;
  return { ok: true, data: row };
}

function atualizar(
  _event: IpcMainInvokeEvent,
  id: number,
  input: { nome: string; descricao?: string; carga_horaria?: string; data_inicio?: string; data_fim?: string }
): ApiResult<CursoLivre> {
  if (!input.nome?.trim()) return { ok: false, error: 'Nome é obrigatório' };
  const db = getDb();
  db.prepare(
    `UPDATE cursos_livres SET nome = ?, descricao = ?, carga_horaria = ?, data_inicio = ?, data_fim = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(input.nome.trim(), input.descricao?.trim() || null, input.carga_horaria?.trim() || null, input.data_inicio || null, input.data_fim || null, id);
  const row = db.prepare('SELECT * FROM cursos_livres WHERE id = ?').get(id) as CursoLivre;
  return { ok: true, data: row };
}

function excluir(_event: IpcMainInvokeEvent, id: number): ApiResult<true> {
  const db = getDb();
  db.prepare('DELETE FROM cursos_livres WHERE id = ?').run(id);
  return { ok: true, data: true };
}

function listarAlunos(_event: IpcMainInvokeEvent, cursoLivreId: number): ApiResult<any[]> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.*, cla.id AS vinculo_id
       FROM curso_livre_alunos cla
       JOIN alunos a ON a.id = cla.aluno_id
       WHERE cla.curso_livre_id = ?
       ORDER BY a.nome ASC`
    )
    .all(cursoLivreId);
  return { ok: true, data: rows };
}

function vincularAluno(_event: IpcMainInvokeEvent, cursoLivreId: number, alunoId: number): ApiResult<true> {
  const db = getDb();
  try {
    db.prepare('INSERT OR IGNORE INTO curso_livre_alunos (curso_livre_id, aluno_id) VALUES (?, ?)').run(cursoLivreId, alunoId);
    return { ok: true, data: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erro ao vincular aluno' };
  }
}

function desvincularAluno(_event: IpcMainInvokeEvent, vinculoId: number): ApiResult<true> {
  const db = getDb();
  db.prepare('DELETE FROM curso_livre_alunos WHERE id = ?').run(vinculoId);
  return { ok: true, data: true };
}

export function registrarCursosLivresHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CURSO_LIVRE_VERIFICAR, requerAuth(verificar));
  ipcMain.handle(IPC_CHANNELS.CURSO_LIVRE_LISTAR, requerAuth(listar));
  ipcMain.handle(IPC_CHANNELS.CURSO_LIVRE_CRIAR, requerAuth(criar));
  ipcMain.handle(IPC_CHANNELS.CURSO_LIVRE_ATUALIZAR, requerAuth(atualizar));
  ipcMain.handle(IPC_CHANNELS.CURSO_LIVRE_EXCLUIR, requerAuth(excluir));
  ipcMain.handle(IPC_CHANNELS.CURSO_LIVRE_LISTAR_ALUNOS, requerAuth(listarAlunos));
  ipcMain.handle(IPC_CHANNELS.CURSO_LIVRE_VINCULAR_ALUNO, requerAuth(vincularAluno));
  ipcMain.handle(IPC_CHANNELS.CURSO_LIVRE_DESVINCULAR_ALUNO, requerAuth(desvincularAluno));
}
