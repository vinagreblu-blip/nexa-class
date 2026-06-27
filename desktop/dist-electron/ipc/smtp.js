"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SMTP_PRESETS = void 0;
exports.obterSmtpConfig = obterSmtpConfig;
exports.registrarSmtpHandlers = registrarSmtpHandlers;
const electron_1 = require("electron");
const database_1 = require("../database");
const types_1 = require("../types");
const auth_1 = require("./auth");
exports.SMTP_PRESETS = {
    gmail: {
        host: 'smtp.gmail.com',
        port: 587,
        label: 'Gmail',
        ajuda: 'Use uma Senha de App (Google → Segurança → Verificação em 2 etapas → Senhas de app)',
    },
    outlook: {
        host: 'smtp.office365.com',
        port: 587,
        label: 'Outlook (Microsoft 365)',
        ajuda: 'Use a senha normal da sua conta Outlook',
    },
    hotmail: {
        host: 'smtp-mail.outlook.com',
        port: 587,
        label: 'Hotmail',
        ajuda: 'Use a senha normal da sua conta Hotmail',
    },
    yahoo: {
        host: 'smtp.mail.yahoo.com',
        port: 587,
        label: 'Yahoo',
        ajuda: 'Gere uma Senha de App (Yahoo → Segurança → Senhas de app)',
    },
};
function obter(_event) {
    const db = (0, database_1.getDb)();
    const row = db
        .prepare("SELECT valor FROM configuracoes WHERE chave = 'smtp'")
        .get();
    if (!row)
        return { ok: true, data: null };
    try {
        const cfg = JSON.parse(row.valor);
        return { ok: true, data: { provedor: cfg.provedor, email: cfg.email, senha: cfg.senha } };
    }
    catch {
        return { ok: true, data: null };
    }
}
function salvar(_event, config) {
    if (!config.provedor || !exports.SMTP_PRESETS[config.provedor]) {
        return { ok: false, error: 'Provedor inválido' };
    }
    if (!config.email?.trim()) {
        return { ok: false, error: 'E-mail é obrigatório' };
    }
    if (!config.senha?.trim()) {
        return { ok: false, error: 'Senha é obrigatória' };
    }
    const db = (0, database_1.getDb)();
    const valor = JSON.stringify({
        provedor: config.provedor.trim(),
        email: config.email.trim(),
        senha: config.senha.trim(),
    });
    db.prepare(`INSERT INTO configuracoes (chave, valor) VALUES ('smtp', ?)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`).run(valor);
    return { ok: true, data: { provedor: config.provedor.trim(), email: config.email.trim(), senha: config.senha.trim() } };
}
/** Lê a config SMTP do banco (para uso por outros módulos, ex: recuperação de senha) */
function obterSmtpConfig() {
    const db = (0, database_1.getDb)();
    const row = db
        .prepare("SELECT valor FROM configuracoes WHERE chave = 'smtp'")
        .get();
    if (!row)
        return null;
    try {
        const cfg = JSON.parse(row.valor);
        const preset = exports.SMTP_PRESETS[cfg.provedor];
        if (!preset)
            return null;
        return {
            host: preset.host,
            port: preset.port,
            user: cfg.email,
            pass: cfg.senha,
            from: cfg.email,
        };
    }
    catch {
        return null;
    }
}
function registrarSmtpHandlers() {
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.SMTP_OBTER, (0, auth_1.requerAdmin)(obter));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.SMTP_SALVAR, (0, auth_1.requerAdmin)(salvar));
}
//# sourceMappingURL=smtp.js.map