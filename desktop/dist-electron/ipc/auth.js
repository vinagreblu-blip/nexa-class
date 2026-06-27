"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSessao = getSessao;
exports.requerAuth = requerAuth;
exports.requerAdmin = requerAdmin;
exports.registrarAuthHandlers = registrarAuthHandlers;
const electron_1 = require("electron");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const database_1 = require("../database");
const types_1 = require("../types");
let sessaoAtual = null;
function getSessao() {
    return sessaoAtual;
}
function requerAuth(fn) {
    return ((event, ...args) => {
        if (!sessaoAtual) {
            return { ok: false, error: 'Não autenticado' };
        }
        return fn(event, ...args);
    });
}
function requerAdmin(fn) {
    return ((event, ...args) => {
        if (!sessaoAtual) {
            return { ok: false, error: 'Não autenticado' };
        }
        if (sessaoAtual.usuario.role !== 'admin') {
            return { ok: false, error: 'Acesso restrito a administradores' };
        }
        return fn(event, ...args);
    });
}
function login(_event, username, password) {
    const db = (0, database_1.getDb)();
    const row = db
        .prepare('SELECT * FROM usuarios WHERE username = ? AND ativo = 1')
        .get(username);
    if (!row) {
        return { ok: false, error: 'Usuário ou senha inválidos' };
    }
    if (!bcryptjs_1.default.compareSync(password, row.password_hash)) {
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
function logout() {
    sessaoAtual = null;
    return { ok: true, data: true };
}
function obterSessao() {
    return { ok: true, data: sessaoAtual?.usuario ?? null };
}
function alterarSenha(_event, senhaAtual, novaSenha) {
    if (!sessaoAtual)
        return { ok: false, error: 'Não autenticado' };
    const db = (0, database_1.getDb)();
    const row = db
        .prepare('SELECT password_hash FROM usuarios WHERE id = ?')
        .get(sessaoAtual.usuario.id);
    if (!bcryptjs_1.default.compareSync(senhaAtual, row.password_hash)) {
        return { ok: false, error: 'Senha atual incorreta' };
    }
    if (novaSenha.length < 6) {
        return { ok: false, error: 'A nova senha deve ter ao menos 6 caracteres' };
    }
    const hash = bcryptjs_1.default.hashSync(novaSenha, 10);
    db.prepare('UPDATE usuarios SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?').run(hash, sessaoAtual.usuario.id);
    return { ok: true, data: true };
}
function registrarAuthHandlers() {
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.AUTH_LOGIN, (event, username, password) => login(event, username, password));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.AUTH_LOGOUT, () => logout());
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.AUTH_SESSAO, () => obterSessao());
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.AUTH_ALTERAR_SENHA, (event, senhaAtual, novaSenha) => alterarSenha(event, senhaAtual, novaSenha));
}
//# sourceMappingURL=auth.js.map