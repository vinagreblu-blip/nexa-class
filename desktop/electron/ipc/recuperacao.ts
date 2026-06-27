import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { getDb } from '../database';
import { CONFIG } from '../config';
import { IPC_CHANNELS } from '../types';
import type { ApiResult } from '../types';
import { obterSmtpConfig } from './smtp';

async function solicitarRecuperacao(
  _event: IpcMainInvokeEvent,
  email: string
): Promise<ApiResult<{ enviado: boolean }>> {
  if (!email?.trim()) return { ok: false, error: 'Informe o e-mail' };

  const db = getDb();
  const user = db
    .prepare('SELECT id, nome FROM usuarios WHERE email = ? AND ativo = 1')
    .get(email.trim()) as { id: number; nome: string } | undefined;

  // Não revela se o e-mail existe (segurança)
  if (!user) return { ok: true, data: { enviado: false } };

  const smtp = obterSmtpConfig();
  if (!smtp) {
    return {
      ok: false,
      error: 'Servidor de e-mail não configurado. Solicite ao administrador que configure o SMTP em Configurações.',
    };
  }

  const token = randomUUID();
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min
  db.prepare('UPDATE usuarios SET reset_token = ?, reset_expires = ? WHERE id = ?').run(
    token,
    expires,
    user.id
  );

  const resetUrl = `http://localhost:${CONFIG.RESET_SERVER_PORT}/redefinir-senha?token=${token}`;

  const transporter = nodemailer.createTransport({
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
  } catch (e: any) {
    console.error('[recuperacao] Erro ao enviar e-mail:', e?.message);
    return { ok: false, error: 'Falha ao enviar o e-mail. Verifique as credenciais SMTP em Configurações.' };
  }
}

export function registrarRecuperacaoHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AUTH_SOLICITAR_RECUPERACAO, solicitarRecuperacao);
}
