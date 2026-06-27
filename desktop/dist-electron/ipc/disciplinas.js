"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrarDisciplinasHandlers = registrarDisciplinasHandlers;
const electron_1 = require("electron");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const database_1 = require("../database");
const config_1 = require("../config");
const types_1 = require("../types");
const auth_1 = require("./auth");
function validarMaster(senha) {
    return bcryptjs_1.default.compareSync(senha ?? '', config_1.CONFIG.SENHA_EXCLUSAO_DECLARACAO_HASH);
}
const SELECT_JOIN = `SELECT d.*, doc.nome AS docente_nome
                     FROM disciplinas d
                     LEFT JOIN docentes doc ON doc.id = d.docente_id`;
function listar(_event, busca) {
    const db = (0, database_1.getDb)();
    let rows;
    if (busca && busca.trim()) {
        const termo = `%${busca.trim()}%`;
        rows = db
            .prepare(`${SELECT_JOIN} WHERE d.nome LIKE ? OR doc.nome LIKE ? OR d.ch LIKE ? ORDER BY d.nome ASC`)
            .all(termo, termo, termo);
    }
    else {
        rows = db.prepare(`${SELECT_JOIN} ORDER BY d.nome ASC`).all();
    }
    return { ok: true, data: rows };
}
function validar(input) {
    if (!input.nome?.trim())
        return 'Nome da disciplina é obrigatório';
    return null;
}
function criar(_event, input) {
    const erro = validar(input);
    if (erro)
        return { ok: false, error: erro };
    const db = (0, database_1.getDb)();
    try {
        const info = db
            .prepare('INSERT INTO disciplinas (nome, docente_id, ch) VALUES (?, ?, ?)')
            .run(input.nome.trim(), input.docente_id ?? null, input.ch?.trim() || null);
        const row = db
            .prepare(`${SELECT_JOIN} WHERE d.id = ?`)
            .get(info.lastInsertRowid);
        return { ok: true, data: row };
    }
    catch (e) {
        if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return { ok: false, error: 'Já existe uma disciplina com esse nome' };
        }
        return { ok: false, error: e?.message ?? 'Erro ao cadastrar disciplina' };
    }
}
function atualizar(_event, id, input, senha) {
    if (!validarMaster(senha))
        return { ok: false, error: 'Senha master incorreta' };
    const erro = validar(input);
    if (erro)
        return { ok: false, error: erro };
    const db = (0, database_1.getDb)();
    try {
        const result = db
            .prepare(`UPDATE disciplinas SET nome = ?, docente_id = ?, ch = ?, updated_at = datetime('now') WHERE id = ?`)
            .run(input.nome.trim(), input.docente_id ?? null, input.ch?.trim() || null, id);
        if (result.changes === 0)
            return { ok: false, error: 'Disciplina não encontrada' };
        const row = db.prepare(`${SELECT_JOIN} WHERE d.id = ?`).get(id);
        return { ok: true, data: row };
    }
    catch (e) {
        if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return { ok: false, error: 'Já existe uma disciplina com esse nome' };
        }
        return { ok: false, error: e?.message ?? 'Erro ao atualizar disciplina' };
    }
}
function excluir(_event, id, senha) {
    if (!validarMaster(senha))
        return { ok: false, error: 'Senha master incorreta' };
    const db = (0, database_1.getDb)();
    const result = db.prepare('DELETE FROM disciplinas WHERE id = ?').run(id);
    if (result.changes === 0)
        return { ok: false, error: 'Disciplina não encontrada' };
    return { ok: true, data: true };
}
function registrarDisciplinasHandlers() {
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DISCIPLINA_LISTAR, (0, auth_1.requerAuth)(listar));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DISCIPLINA_CRIAR, (0, auth_1.requerAuth)(criar));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DISCIPLINA_ATUALIZAR, (0, auth_1.requerAuth)(atualizar));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DISCIPLINA_EXCLUIR, (0, auth_1.requerAuth)(excluir));
}
//# sourceMappingURL=disciplinas.js.map