import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import bcrypt from 'bcryptjs';
import { getDb } from '../database';
import { IPC_CHANNELS } from '../types';
import type { ApiResult, Sessao, Usuario, UsuarioPublico, UsuarioInput } from '../types';

let sessaoAtual: Sessao | null = null;

export function getSessao(): Sessao | null {
  return sessaoAtual;
}

export function requerAuth<T extends (...args: any[]) => any>(fn: T): T {
  return ((event: IpcMainInvokeEvent, ...args: Parameters<T>) => {
    if (!sessaoAtual) {
      return { ok: false, error: 'Não autenticado' };
    }
    return fn(event, ...args);
  }) as T;
}

export function requerAdmin<T extends (...args: any[]) => any>(fn: T): T {
  return ((event: IpcMainInvokeEvent, ...args: Parameters<T>) => {
    if (!sessaoAtual) {
      return { ok: false, error: 'Não autenticado' };
    }
    if (sessaoAtual.usuario.role !== 'admin') {
      return { ok: false, error: 'Acesso restrito a administradores' };
    }
    return fn(event, ...args);
  }) as T;
}

function login(_event: IpcMainInvokeEvent, username: string, password: string): ApiResult<UsuarioPublico> {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM usuarios WHERE username = ? AND ativo = 1')
    .get(username) as (Usuario & { password_hash: string }) | undefined;

  if (!row) {
    return { ok: false, error: 'Usuário ou senha inválidos' };
  }

  if (!bcrypt.compareSync(password, row.password_hash)) {
    return { ok: false, error: 'Usuário ou senha inválidos' };
  }

  sessaoAtual = {
    usuario: {
      id: row.id,
      codigo: row.codigo,
      username: row.username,
      nome: row.nome,
      email: row.email,
      role: row.role,
      foto_path: row.foto_path,
      ativo: row.ativo,
    },
  };

  return { ok: true, data: sessaoAtual.usuario };
}

function logout(): ApiResult<true> {
  sessaoAtual = null;
  return { ok: true, data: true };
}

function obterSessao(): ApiResult<UsuarioPublico | null> {
  return { ok: true, data: sessaoAtual?.usuario ?? null };
}

function alterarSenha(
  _event: IpcMainInvokeEvent,
  senhaAtual: string,
  novaSenha: string
): ApiResult<true> {
  if (!sessaoAtual) return { ok: false, error: 'Não autenticado' };
  const db = getDb();
  const row = db
    .prepare('SELECT password_hash FROM usuarios WHERE id = ?')
    .get(sessaoAtual.usuario.id) as { password_hash: string };

  if (!bcrypt.compareSync(senhaAtual, row.password_hash)) {
    return { ok: false, error: 'Senha atual incorreta' };
  }

  if (novaSenha.length < 6) {
    return { ok: false, error: 'A nova senha deve ter ao menos 6 caracteres' };
  }

  const hash = bcrypt.hashSync(novaSenha, 10);
  db.prepare('UPDATE usuarios SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
    hash,
    sessaoAtual.usuario.id
  );
  return { ok: true, data: true };
}

export function registrarAuthHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, (event, username: string, password: string) =>
    login(event, username, password)
  );
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, () => logout());
  ipcMain.handle(IPC_CHANNELS.AUTH_SESSAO, () => obterSessao());
  ipcMain.handle(
    IPC_CHANNELS.AUTH_ALTERAR_SENHA,
    (event, senhaAtual: string, novaSenha: string) => alterarSenha(event, senhaAtual, novaSenha)
  );
}
