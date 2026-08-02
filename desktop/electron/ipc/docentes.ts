import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import bcrypt from 'bcryptjs';
import { getDb } from '../database';
import { CONFIG } from '../config';
import { IPC_CHANNELS } from '../types';
import type { ApiResult, Docente, DocenteInput } from '../types';
import { getSessao, requerAuth } from './auth';

function validarMaster(senha: string): boolean {
  return bcrypt.compareSync(senha ?? '', CONFIG.SENHA_EXCLUSAO_DECLARACAO_HASH);
}

function listar(_event: IpcMainInvokeEvent, busca?: string): ApiResult<Docente[]> {
  const db = getDb();
  let rows: Docente[];
  if (busca && busca.trim()) {
    const termo = `%${busca.trim()}%`;
    rows = db
      .prepare(
        `SELECT * FROM docentes WHERE nome LIKE ? OR titulacao LIKE ? ORDER BY nome ASC`
      )
      .all(termo, termo) as Docente[];
  } else {
    rows = db.prepare('SELECT * FROM docentes ORDER BY nome ASC').all() as Docente[];
  }
  return { ok: true, data: rows };
}

function validar(input: DocenteInput): string | null {
  if (!input.nome?.trim()) return 'Nome é obrigatório';
  return null;
}

function criar(_event: IpcMainInvokeEvent, input: DocenteInput): ApiResult<Docente> {
  const erro = validar(input);
  if (erro) return { ok: false, error: erro };
  const db = getDb();
  try {
    const info = db
      .prepare('INSERT INTO docentes (nome, titulacao) VALUES (?, ?)')
      .run(input.nome.trim(), input.titulacao?.trim() || null);
    const row = db.prepare('SELECT * FROM docentes WHERE id = ?').get(info.lastInsertRowid) as Docente;
    return { ok: true, data: row };
  } catch (e: any) {
    if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { ok: false, error: 'Já existe um docente com esse nome' };
    }
    return { ok: false, error: e?.message ?? 'Erro ao cadastrar docente' };
  }
}

function atualizar(
  _event: IpcMainInvokeEvent,
  id: number,
  input: DocenteInput,
  senha: string
): ApiResult<Docente> {
  if (!validarMaster(senha)) return { ok: false, error: 'Senha master incorreta' };
  const erro = validar(input);
  if (erro) return { ok: false, error: erro };
  const db = getDb();
  try {
    const result = db
      .prepare(
        `UPDATE docentes SET nome = ?, titulacao = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .run(input.nome.trim(), input.titulacao?.trim() || null, id);
    if (result.changes === 0) return { ok: false, error: 'Docente não encontrado' };
    const row = db.prepare('SELECT * FROM docentes WHERE id = ?').get(id) as Docente;
    return { ok: true, data: row };
  } catch (e: any) {
    if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { ok: false, error: 'Já existe um docente com esse nome' };
    }
    return { ok: false, error: e?.message ?? 'Erro ao atualizar docente' };
  }
}

function excluir(_event: IpcMainInvokeEvent, id: number, senha: string): ApiResult<true> {
  if (!validarMaster(senha)) return { ok: false, error: 'Senha master incorreta' };
  const db = getDb();
  const result = db.prepare('DELETE FROM docentes WHERE id = ?').run(id);
  if (result.changes === 0) return { ok: false, error: 'Docente não encontrado' };
  return { ok: true, data: true };
}

export function registrarDocentesHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.DOCENTE_LISTAR, requerAuth(listar));
  ipcMain.handle(IPC_CHANNELS.DOCENTE_CRIAR, requerAuth(criar));
  ipcMain.handle(IPC_CHANNELS.DOCENTE_ATUALIZAR, requerAuth(atualizar));
  ipcMain.handle(IPC_CHANNELS.DOCENTE_EXCLUIR, requerAuth(excluir));
}
