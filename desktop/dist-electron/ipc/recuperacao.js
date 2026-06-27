"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrarRecuperacaoHandlers = registrarRecuperacaoHandlers;
const electron_1 = require("electron");
const node_crypto_1 = require("node:crypto");
const nodemailer_1 = __importDefault(require("nodemailer"));
const database_1 = require("../database");
const config_1 = require("../config");
const types_1 = require("../types");
const smtp_1 = require("./smtp");
async function solicitarRecuperacao(_event, email) {
    if (!email?.trim())
        return { ok: false, error: 'Informe o e-mail' };
    const db = (0, database_1.getDb)();
    const user = db
        .prepare('SELECT id, nome FROM usuarios WHERE email = ? AND ativo = 1')
        .get(email.trim());
    // Não revela se o e-mail existe (segurança)
    if (!user)
        return { ok: true, data: { enviado: false } };
    const smtp = (0, smtp_1.obterSmtpConfig)();
    if (!smtp) {
        return {
            ok: false,
            error: 'Servidor de e-mail não configurado. Solicite ao administrador que configure o SMTP em Configurações.',
        };
    }
    const token = (0, node_crypto_1.randomUUID)();
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min
    db.prepare('UPDATE usuarios SET reset_token = ?, reset_expires = ? WHERE id = ?').run(token, expires, user.id);
    const resetUrl = `http://localhost:${config_1.CONFIG.RESET_SERVER_PORT}/redefinir-senha?token=${token}`;
    const transporter = nodemailer_1.default.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.port === 465,
        auth: { user: smtp.user, pass: smtp.pass },
    });
    try {
        await transporter.sendMail({
            from: smtp.from,
            to: email.trim(),
            subject: 'Recuperação de Senha — NEXA CLASS',
            html: `
        <h2>Recuperação de Senha — NEXA CLASS</h2>
        <p>Olá, <strong>${user.nome}</strong>.</p>
        <p>Você solicitou a redefinição de sua senha. Clique no link abaixo para definir uma nova senha:</p>
        <p><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#1f4e5f;color:#fff;text-decoration:none;border-radius:8px;">Redefinir Senha</a></p>
        <p>Ou copie e cole este link no navegador: <br><a href="${resetUrl}">${resetUrl}</a></p>
        <p style="color:#999;font-size:12px;">Este link expira em 30 minutos. Se você não solicitou esta recuperação, ignore este e-mail.</p>
      `,
        });
        return { ok: true, data: { enviado: true } };
    }
    catch (e) {
        console.error('[recuperacao] Erro ao enviar e-mail:', e?.message);
        return { ok: false, error: 'Falha ao enviar o e-mail. Verifique as credenciais SMTP em Configurações.' };
    }
}
function registrarRecuperacaoHandlers() {
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.AUTH_SOLICITAR_RECUPERACAO, solicitarRecuperacao);
}
//# sourceMappingURL=recuperacao.js.map