"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrarUsuariosHandlers = registrarUsuariosHandlers;
const electron_1 = require("electron");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const database_1 = require("../database");
const config_1 = require("../config");
const types_1 = require("../types");
const auth_1 = require("./auth");
function semHash(u) {
    const { password_hash, ...rest } = u;
    return rest;
}
function listar() {
    const db = (0, database_1.getDb)();
    const sessao = (0, auth_1.getSessao)();
    const isOperador = sessao?.usuario.role !== 'admin';
    const rows = db
        .prepare('SELECT * FROM usuarios ORDER BY nome ASC')
        .all()
        .filter((u) => {
        // Operadores não veem o usuário admin
        if (isOperador && u.username === 'admin')
            return false;
        return true;
    })
        .map(semHash);
    return { ok: true, data: rows };
}
function validarInput(input) {
    if (!input.username?.trim())
        return 'Username é obrigatório';
    if (!input.nome?.trim())
        return 'Nome é obrigatório';
    if (!input.password || input.password.length < 6) {
        return 'A senha deve ter ao menos 6 caracteres';
    }
    if (input.role !== 'admin' && input.role !== 'operador') {
        return 'Role inválido';
    }
    return null;
}
function criar(_event, input) {
    const erro = validarInput(input);
    if (erro)
        return { ok: false, error: erro };
    const db = (0, database_1.getDb)();
    try {
        const hash = bcryptjs_1.default.hashSync(input.password, 10);
        const codigo = (0, database_1.gerarCodigoUsuarioUnico)();
        const info = db
            .prepare(`INSERT INTO usuarios (codigo, username, password_hash, nome, email, role)
         VALUES (?, ?, ?, ?, ?, ?)`)
            .run(codigo, input.username.trim(), hash, input.nome.trim(), input.email?.trim() || null, input.role);
        const row = semHash(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(info.lastInsertRowid));
        return { ok: true, data: row };
    }
    catch (e) {
        if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return { ok: false, error: 'Já existe um usuário com esse username' };
        }
        return { ok: false, error: e?.message ?? 'Erro ao criar usuário' };
    }
}
function atualizar(_event, id, input) {
    if (!input.username?.trim())
        return { ok: false, error: 'Username é obrigatório' };
    if (!input.nome?.trim())
        return { ok: false, error: 'Nome é obrigatório' };
    const db = (0, database_1.getDb)();
    const existente = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    if (!existente)
        return { ok: false, error: 'Usuário não encontrado' };
    try {
        if (input.password) {
            if (input.password.length < 6) {
                return { ok: false, error: 'A senha deve ter ao menos 6 caracteres' };
            }
            const hash = bcryptjs_1.default.hashSync(input.password, 10);
            db.prepare(`UPDATE usuarios
         SET username = ?, nome = ?, email = ?, role = ?, password_hash = ?, ativo = ?, updated_at = datetime('now')
         WHERE id = ?`).run(input.username.trim(), input.nome.trim(), input.email?.trim() || null, input.role, hash, input.ativo === false ? 0 : 1, id);
        }
        else {
            db.prepare(`UPDATE usuarios
         SET username = ?, nome = ?, email = ?, role = ?, ativo = ?, updated_at = datetime('now')
         WHERE id = ?`).run(input.username.trim(), input.nome.trim(), input.email?.trim() || null, input.role, input.ativo === false ? 0 : 1, id);
        }
        const row = semHash(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id));
        return { ok: true, data: row };
    }
    catch (e) {
        if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return { ok: false, error: 'Já existe um usuário com esse username' };
        }
        return { ok: false, error: e?.message ?? 'Erro ao atualizar usuário' };
    }
}
function excluir(_event, id) {
    const sessao = (0, auth_1.getSessao)();
    if (sessao?.usuario.id === id) {
        return { ok: false, error: 'Você não pode excluir o próprio usuário' };
    }
    const db = (0, database_1.getDb)();
    const countAdmins = db
        .prepare("SELECT COUNT(*) AS total FROM usuarios WHERE role = 'admin' AND ativo = 1")
        .get();
    const alvo = db.prepare('SELECT role, ativo FROM usuarios WHERE id = ?').get(id);
    if (alvo?.role === 'admin' && alvo.ativo === 1 && countAdmins.total <= 1) {
        return { ok: false, error: 'Não é possível excluir o último administrador ativo' };
    }
    const result = db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
    if (result.changes === 0)
        return { ok: false, error: 'Usuário não encontrado' };
    // remove foto do disco
    try {
        const row = db.prepare('SELECT foto_path FROM usuarios WHERE id = ?').get(id);
        if (row?.foto_path && node_fs_1.default.existsSync(row.foto_path))
            node_fs_1.default.unlinkSync(row.foto_path);
    }
    catch {
        /* a tabela já pode ter sido afetada pelo cascade; ignora */
    }
    return { ok: true, data: true };
}
function getFotosDir() {
    const dir = node_path_1.default.join(electron_1.app.getPath('userData'), 'fotos-usuarios');
    if (!node_fs_1.default.existsSync(dir))
        node_fs_1.default.mkdirSync(dir, { recursive: true });
    return dir;
}
async function trocarFoto(event, userId) {
    const sessao = (0, auth_1.getSessao)();
    if (!sessao)
        return { ok: false, error: 'Não autenticado' };
    // Admin pode trocar a foto de qualquer um; operador só a sua própria
    const isOperador = sessao.usuario.role !== 'admin';
    if (isOperador && sessao.usuario.id !== userId) {
        return { ok: false, error: 'Operadores só podem alterar a própria foto' };
    }
    const db = (0, database_1.getDb)();
    const win = electron_1.BrowserWindow.fromWebContents(event.sender);
    if (!win)
        return { ok: false, error: 'Janela não disponível' };
    const res = await electron_1.dialog.showOpenDialog(win, {
        title: 'Selecionar foto de perfil',
        properties: ['openFile'],
        filters: [{ name: 'Imagens', extensions: ['jpg', 'jpeg', 'png'] }],
    });
    if (res.canceled || res.filePaths.length === 0) {
        return { ok: false, error: 'Nenhum arquivo selecionado' };
    }
    const origem = res.filePaths[0];
    const ext = node_path_1.default.extname(origem).toLowerCase() || '.png';
    const destino = node_path_1.default.join(getFotosDir(), `${userId}${ext}`);
    // remove foto anterior (qualquer extensão)
    const anterior = db.prepare('SELECT foto_path FROM usuarios WHERE id = ?').get(userId);
    if (anterior?.foto_path && node_fs_1.default.existsSync(anterior.foto_path) && anterior.foto_path !== destino) {
        try {
            node_fs_1.default.unlinkSync(anterior.foto_path);
        }
        catch {
            /* ignora */
        }
    }
    node_fs_1.default.copyFileSync(origem, destino);
    db.prepare('UPDATE usuarios SET foto_path = ?, updated_at = datetime(\'now\') WHERE id = ?').run(destino, userId);
    const row = semHash(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(userId));
    return { ok: true, data: row };
}
function foto(_event, userId) {
    const db = (0, database_1.getDb)();
    const row = db.prepare('SELECT foto_path FROM usuarios WHERE id = ?').get(userId);
    const p = row?.foto_path;
    if (!p || !node_fs_1.default.existsSync(p))
        return { ok: true, data: { dataUrl: null } };
    try {
        const buf = node_fs_1.default.readFileSync(p);
        const ext = node_path_1.default.extname(p).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
        return { ok: true, data: { dataUrl: `data:${mime};base64,${buf.toString('base64')}` } };
    }
    catch {
        return { ok: true, data: { dataUrl: null } };
    }
}
function resetarSenha(_event, userId, masterPassword) {
    if (!bcryptjs_1.default.compareSync(masterPassword ?? '', config_1.CONFIG.SENHA_EXCLUSAO_DECLARACAO_HASH)) {
        return { ok: false, error: 'Senha master incorreta' };
    }
    const db = (0, database_1.getDb)();
    const SENHA_TEMP = 'senha123';
    const hash = bcryptjs_1.default.hashSync(SENHA_TEMP, 10);
    const result = db
        .prepare(`UPDATE usuarios SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(hash, userId);
    if (result.changes === 0)
        return { ok: false, error: 'Usuário não encontrado' };
    return { ok: true, data: { senhaTemporaria: SENHA_TEMP } };
}
function registrarUsuariosHandlers() {
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.USUARIO_LISTAR, (0, auth_1.requerAuth)((0, auth_1.requerAdmin)(listar)));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.USUARIO_CRIAR, (0, auth_1.requerAdmin)(criar));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.USUARIO_ATUALIZAR, (0, auth_1.requerAdmin)(atualizar));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.USUARIO_EXCLUIR, (0, auth_1.requerAdmin)(excluir));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.USUARIO_TROCAR_FOTO, (0, auth_1.requerAuth)(trocarFoto));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.USUARIO_FOTO, (0, auth_1.requerAuth)(foto));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.USUARIO_RESETAR_SENHA, (0, auth_1.requerAdmin)(resetarSenha));
}
//# sourceMappingURL=usuarios.js.map