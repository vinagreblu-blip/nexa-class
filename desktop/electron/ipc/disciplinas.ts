import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import bcrypt from 'bcryptjs';
import { getDb } from '../database';
import { CONFIG } from '../config';
import { IPC_CHANNELS } from '../types';
import type { ApiResult, Disciplina, DisciplinaInput } from '../types';
import { getSessao, requerAuth } from './auth';

function validarMaster(senha: string): boolean {
  return bcrypt.compareSync(senha ?? '', CONFIG.SENHA_EXCLUSAO_DECLARACAO_HASH);
}

const SELECT_JOIN = `SELECT d.*, doc.nome AS docente_nome
                     FROM disciplinas d
                     LEFT JOIN docentes doc ON doc.id = d.docente_id`;

function listar(_event: IpcMainInvokeEvent, busca?: string): ApiResult<Disciplina[]> {
  const db = getDb();
  let rows: Disciplina[];
  if (busca && busca.trim()) {
    const termo = `%${busca.trim()}%`;
    rows = db
      .prepare(
        `${SELECT_JOIN} WHERE d.nome LIKE ? OR doc.nome LIKE ? OR d.ch LIKE ? ORDER BY d.nome ASC`
      )
      .all(termo, termo, termo) as Disciplina[];
  } else {
    rows = db.prepare(`${SELECT_JOIN} ORDER BY d.nome ASC`).all() as Disciplina[];
  }
  return { ok: true, data: rows };
}

function validar(input: DisciplinaInput): string | null {
  if (!input.nome?.trim()) return 'Nome da disciplina é obrigatório';
  return null;
}

function criar(_event: IpcMainInvokeEvent, input: DisciplinaInput): ApiResult<Disciplina> {
  const erro = validar(input);
  if (erro) return { ok: false, error: erro };
  const db = getDb();
  try {
    const info = db
      .prepare('INSERT INTO disciplinas (nome, docente_id, ch) VALUES (?, ?, ?)')
      .run(input.nome.trim(), input.docente_id ?? null, input.ch?.trim() || null);
    const row = db
      .prepare(`${SELECT_JOIN} WHERE d.id = ?`)
      .get(info.lastInsertRowid) as Disciplina;
    return { ok: true, data: row };
  } catch (e: any) {
    if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { ok: false, error: 'Já existe uma disciplina com esse nome' };
    }
    return { ok: false, error: e?.message ?? 'Erro ao cadastrar disciplina' };
  }
}

function atualizar(
  _event: IpcMainInvokeEvent,
  id: number,
  input: DisciplinaInput,
  senha: string
): ApiResult<Disciplina> {
  if (!validarMaster(senha)) return { ok: false, error: 'Senha master incorreta' };
  const erro = validar(input);
  if (erro) return { ok: false, error: erro };
  const db = getDb();
  try {
    const result = db
      .prepare(
        `UPDATE disciplinas SET nome = ?, docente_id = ?, ch = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .run(input.nome.trim(), input.docente_id ?? null, input.ch?.trim() || null, id);
    if (result.changes === 0) return { ok: false, error: 'Disciplina não encontrada' };
    const row = db.prepare(`${SELECT_JOIN} WHERE d.id = ?`).get(id) as Disciplina;
    return { ok: true, data: row };
  } catch (e: any) {
    if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { ok: false, error: 'Já existe uma disciplina com esse nome' };
    }
    return { ok: false, error: e?.message ?? 'Erro ao atualizar disciplina' };
  }
}

function excluir(_event: IpcMainInvokeEvent, id: number, senha: string): ApiResult<true> {
  if (!validarMaster(senha)) return { ok: false, error: 'Senha master incorreta' };
  const db = getDb();
  const result = db.prepare('DELETE FROM disciplinas WHERE id = ?').run(id);
  if (result.changes === 0) return { ok: false, error: 'Disciplina não encontrada' };
  return { ok: true, data: true };
}

export function registrarDisciplinasHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.DISCIPLINA_LISTAR, requerAuth(listar));
  ipcMain.handle(IPC_CHANNELS.DISCIPLINA_CRIAR, requerAuth(criar));
  ipcMain.handle(IPC_CHANNELS.DISCIPLINA_ATUALIZAR, requerAuth(atualizar));
  ipcMain.handle(IPC_CHANNELS.DISCIPLINA_EXCLUIR, requerAuth(excluir));
}
