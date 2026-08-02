import { ipcMain, IpcMainInvokeEvent, dialog, BrowserWindow, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getDb, gerarCodigoUsuarioUnico } from '../database';
import { CONFIG } from '../config';
import { IPC_CHANNELS } from '../types';
import type { ApiResult, Usuario, UsuarioInput } from '../types';
import { getSessao, requerAdmin, requerAuth } from './auth';

function semHash(u: any): Usuario {
  const { password_hash, ...rest } = u;
  return rest as Usuario;
}

function listar(): ApiResult<Usuario[]> {
  const db = getDb();
  const sessao = getSessao();
  const isOperador = sessao?.usuario.role !== 'admin';
  const rows = db
    .prepare('SELECT * FROM usuarios ORDER BY nome ASC')
    .all()
    .filter((u: any) => {
      // Operadores não veem o usuário admin
      if (isOperador && u.username === 'admin') return false;
      return true;
    })
    .map(semHash) as Usuario[];
  return { ok: true, data: rows };
}

function validarInput(input: UsuarioInput): string | null {
  if (!input.username?.trim()) return 'Username é obrigatório';
  if (!input.nome?.trim()) return 'Nome é obrigatório';
  if (!input.password || input.password.length < 6) {
    return 'A senha deve ter ao menos 6 caracteres';
  }
  if (input.role !== 'admin' && input.role !== 'operador') {
    return 'Role inválido';
  }
  return null;
}

function criar(_event: IpcMainInvokeEvent, input: UsuarioInput): ApiResult<Usuario> {
  const erro = validarInput(input);
  if (erro) return { ok: false, error: erro };

  const db = getDb();
  try {
    const hash = bcrypt.hashSync(input.password, 10);
    const codigo = gerarCodigoUsuarioUnico();
    const info = db
      .prepare(
        `INSERT INTO usuarios (codigo, username, password_hash, nome, email, role)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(codigo, input.username.trim(), hash, input.nome.trim(), input.email?.trim() || null, input.role);
    const row = semHash(
      db.prepare('SELECT * FROM usuarios WHERE id = ?').get(info.lastInsertRowid)
    );
    return { ok: true, data: row };
  } catch (e: any) {
    if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { ok: false, error: 'Já existe um usuário com esse username' };
    }
    return { ok: false, error: e?.message ?? 'Erro ao criar usuário' };
  }
}

function atualizar(
  _event: IpcMainInvokeEvent,
  id: number,
  input: { username: string; nome: string; email?: string; role: 'admin' | 'operador'; password?: string; ativo?: boolean }
): ApiResult<Usuario> {
  if (!input.username?.trim()) return { ok: false, error: 'Username é obrigatório' };
  if (!input.nome?.trim()) return { ok: false, error: 'Nome é obrigatório' };

  const db = getDb();
  const existente = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id) as Usuario | undefined;
  if (!existente) return { ok: false, error: 'Usuário não encontrado' };

  try {
    if (input.password) {
      if (input.password.length < 6) {
        return { ok: false, error: 'A senha deve ter ao menos 6 caracteres' };
      }
      const hash = bcrypt.hashSync(input.password, 10);
      db.prepare(
        `UPDATE usuarios
         SET username = ?, nome = ?, email = ?, role = ?, password_hash = ?, ativo = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        input.username.trim(),
        input.nome.trim(),
        input.email?.trim() || null,
        input.role,
        hash,
        input.ativo === false ? 0 : 1,
        id
      );
    } else {
      db.prepare(
        `UPDATE usuarios
         SET username = ?, nome = ?, email = ?, role = ?, ativo = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        input.username.trim(),
        input.nome.trim(),
        input.email?.trim() || null,
        input.role,
        input.ativo === false ? 0 : 1,
        id
      );
    }

    const row = semHash(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id));
    return { ok: true, data: row };
  } catch (e: any) {
    if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { ok: false, error: 'Já existe um usuário com esse username' };
    }
    return { ok: false, error: e?.message ?? 'Erro ao atualizar usuário' };
  }
}

function excluir(_event: IpcMainInvokeEvent, id: number): ApiResult<true> {
  const sessao = getSessao();
  if (sessao?.usuario.id === id) {
    return { ok: false, error: 'Você não pode excluir o próprio usuário' };
  }

  const db = getDb();
  const countAdmins = db
    .prepare("SELECT COUNT(*) AS total FROM usuarios WHERE role = 'admin' AND ativo = 1")
    .get() as { total: number };
  const alvo = db.prepare('SELECT role, ativo FROM usuarios WHERE id = ?').get(id) as
    | { role: string; ativo: number }
    | undefined;

  if (alvo?.role === 'admin' && alvo.ativo === 1 && countAdmins.total <= 1) {
    return { ok: false, error: 'Não é possível excluir o último administrador ativo' };
  }

  const result = db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
  if (result.changes === 0) return { ok: false, error: 'Usuário não encontrado' };
  // remove foto do disco
  try {
    const row = db.prepare('SELECT foto_path FROM usuarios WHERE id = ?').get(id) as { foto_path: string | null } | undefined;
    if (row?.foto_path && fs.existsSync(row.foto_path)) fs.unlinkSync(row.foto_path);
  } catch {
    /* a tabela já pode ter sido afetada pelo cascade; ignora */
  }
  return { ok: true, data: true };
}

function getFotosDir(): string {
  const dir = path.join(app.getPath('userData'), 'fotos-usuarios');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function trocarFoto(
  event: IpcMainInvokeEvent,
  userId: number
): Promise<ApiResult<Usuario>> {
  const sessao = getSessao();
  if (!sessao) return { ok: false, error: 'Não autenticado' };
  // Admin pode trocar a foto de qualquer um; operador só a sua própria
  const isOperador = sessao.usuario.role !== 'admin';
  if (isOperador && sessao.usuario.id !== userId) {
    return { ok: false, error: 'Operadores só podem alterar a própria foto' };
  }
  const db = getDb();
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, error: 'Janela não disponível' };

  const res = await dialog.showOpenDialog(win, {
    title: 'Selecionar foto de perfil',
    properties: ['openFile'],
    filters: [{ name: 'Imagens', extensions: ['jpg', 'jpeg', 'png'] }],
  });
  if (res.canceled || res.filePaths.length === 0) {
    return { ok: false, error: 'Nenhum arquivo selecionado' };
  }

  const origem = res.filePaths[0];
  const ext = path.extname(origem).toLowerCase() || '.png';
  const destino = path.join(getFotosDir(), `${userId}${ext}`);

  // remove foto anterior (qualquer extensão)
  const anterior = db.prepare('SELECT foto_path FROM usuarios WHERE id = ?').get(userId) as
    | { foto_path: string | null }
    | undefined;
  if (anterior?.foto_path && fs.existsSync(anterior.foto_path) && anterior.foto_path !== destino) {
    try {
      fs.unlinkSync(anterior.foto_path);
    } catch {
      /* ignora */
    }
  }

  fs.copyFileSync(origem, destino);
  db.prepare('UPDATE usuarios SET foto_path = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
    destino,
    userId
  );
  const row = semHash(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(userId));
  return { ok: true, data: row };
}

function foto(
  _event: IpcMainInvokeEvent,
  userId: number
): ApiResult<{ dataUrl: string | null }> {
  const db = getDb();
  const row = db.prepare('SELECT foto_path FROM usuarios WHERE id = ?').get(userId) as
    | { foto_path: string | null }
    | undefined;
  const p = row?.foto_path;
  if (!p || !fs.existsSync(p)) return { ok: true, data: { dataUrl: null } };
  try {
    const buf = fs.readFileSync(p);
    const ext = path.extname(p).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    return { ok: true, data: { dataUrl: `data:${mime};base64,${buf.toString('base64')}` } };
  } catch {
    return { ok: true, data: { dataUrl: null } };
  }
}

function resetarSenha(
  _event: IpcMainInvokeEvent,
  userId: number,
  masterPassword: string
): ApiResult<{ senhaTemporaria: string }> {
  if (!bcrypt.compareSync(masterPassword ?? '', CONFIG.SENHA_EXCLUSAO_DECLARACAO_HASH)) {
    return { ok: false, error: 'Senha master incorreta' };
  }
  const db = getDb();
  // Gera senha temporária aleatória (16 chars) — nunca hardcoded.
  // O admin deve comunicá-la ao usuário de forma segura e este deve trocá-la no primeiro login.
  const SENHA_TEMP = crypto.randomBytes(12).toString('base64url').slice(0, 16);
  const hash = bcrypt.hashSync(SENHA_TEMP, 10);
  const result = db
    .prepare(`UPDATE usuarios SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(hash, userId);
  if (result.changes === 0) return { ok: false, error: 'Usuário não encontrado' };
  return { ok: true, data: { senhaTemporaria: SENHA_TEMP } };
}

export function registrarUsuariosHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.USUARIO_LISTAR, requerAuth(requerAdmin(listar)));
  ipcMain.handle(IPC_CHANNELS.USUARIO_CRIAR, requerAdmin(criar));
  ipcMain.handle(IPC_CHANNELS.USUARIO_ATUALIZAR, requerAdmin(atualizar));
  ipcMain.handle(IPC_CHANNELS.USUARIO_EXCLUIR, requerAdmin(excluir));
  ipcMain.handle(IPC_CHANNELS.USUARIO_TROCAR_FOTO, requerAuth(trocarFoto));
  ipcMain.handle(IPC_CHANNELS.USUARIO_FOTO, requerAuth(foto));
  ipcMain.handle(IPC_CHANNELS.USUARIO_RESETAR_SENHA, requerAdmin(resetarSenha));
}
