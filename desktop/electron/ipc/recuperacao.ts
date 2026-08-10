import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { getDb } from '../database';
import { IPC_CHANNELS } from '../types';
import type { ApiResult } from '../types';
import { obterSmtpConfig } from './smtp';
import { validarEstadoReset, validarNovaSenha, RESET_TENTATIVAS_MAX } from '../utils/regras';
import { logger } from '../utils/logger';

/**
 * Fluxo de recuperação de senha (Opção A — token por e-mail digitado).
 *
 * Antes: e-mail enviava link http://localhost:3457/redefinir?token=UUID que
 * abria um form no browser. O `reset-server` HTTP local só funcionava na mesma
 * máquina — feature 100% quebrada em qualquer cenário real (usuário no celular,
 * admin em casa, etc.).
 *
 * Agora: e-mail envia código de 6 dígitos; usuário digita no app junto com a
 * nova senha. Sem servidor HTTP, sem link quebrado, funciona em qualquer device
 * onde o app esteja instalado.
 *
 * Segurança:
 *  - Código de 6 dígitos (10^6 combinações), TTL 30 min
 *  - Hash bcrypt do código guardado no DB (proteção contra leak)
 *  - Lockout após RESET_TENTATIVAS_MAX tentativas falhas (invalida o token)
 *  - Mensagens genéricas para não revelar se e-mail existe
 */

/** Gera código numérico de 6 dígitos com zero à esquerda (ex.: "048291"). */
function gerarCodigo6Digitos(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

async function solicitarRecuperacao(
  _event: IpcMainInvokeEvent,
  email: string
): Promise<ApiResult<{ enviado: boolean }>> {
  if (!email?.trim()) return { ok: false, error: 'Informe o e-mail' };

  const db = getDb();
  const user = db
    .prepare('SELECT id, nome FROM usuarios WHERE email = ? AND ativo = 1')
    .get(email.trim()) as { id: number; nome: string } | undefined;

  // Não revela se o e-mail existe (segurança).
  if (!user) return { ok: true, data: { enviado: false } };

  const smtp = obterSmtpConfig();
  if (!smtp) {
    return {
      ok: false,
      error:
        'Servidor de e-mail não configurado. Solicite ao administrador que configure o SMTP em Configurações.',
    };
  }

  const codigo = gerarCodigo6Digitos();
  const hash = bcrypt.hashSync(codigo, 10);
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min

  // Guarda o HASH do código (nunca o plaintext) e zera o contador de tentativas.
  db.prepare(
    `UPDATE usuarios SET reset_token = ?, reset_expires = ?, reset_attempts = 0 WHERE id = ?`
  ).run(hash, expires, user.id);

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
      subject: 'Código de Recuperação — NEXA CLASS',
      html: `
        <h2>Recuperação de Senha — NEXA CLASS</h2>
        <p>Olá, <strong>${escapeHtml(user.nome)}</strong>.</p>
        <p>Use o código abaixo para redefinir sua senha no aplicativo NEXA CLASS:</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:8px;
                  font-family:monospace;background:#f0f4f8;padding:16px 24px;
                  border-radius:8px;text-align:center;color:#1f4e5f;">
          ${codigo}
        </p>
        <p>O código expira em 30 minutos.</p>
        <p style="color:#999;font-size:12px;">
          Se você não solicitou esta recuperação, ignore este e-mail.
        </p>
      `,
    });
    return { ok: true, data: { enviado: true } };
  } catch (e: any) {
    logger.error({ err: e }, 'Erro ao enviar e-mail de recuperação');
    return {
      ok: false,
      error: 'Falha ao enviar o e-mail. Verifique as credenciais SMTP em Configurações.',
    };
  }
}

interface RedefinirInput {
  email: string;
  codigo: string;
  novaSenha: string;
}

async function redefinirComToken(
  _event: IpcMainInvokeEvent,
  input: RedefinirInput
): Promise<ApiResult<true>> {
  if (!input.email?.trim()) return { ok: false, error: 'E-mail obrigatório' };
  if (!input.codigo?.trim()) return { ok: false, error: 'Código obrigatório' };

  const erroSenha = validarNovaSenha(input.novaSenha);
  if (erroSenha) return { ok: false, error: erroSenha };

  const db = getDb();
  const user = db
    .prepare('SELECT id, reset_token, reset_expires, reset_attempts FROM usuarios WHERE email = ? AND ativo = 1')
    .get(input.email.trim()) as
    | {
        id: number;
        reset_token: string | null;
        reset_expires: string | null;
        reset_attempts: number;
      }
    | undefined;

  // Mensagem genérica para não revelar se e-mail existe ou tem token ativo.
  if (!user) {
    return { ok: false, error: 'Código inválido, expirado ou já utilizado.' };
  }

  const estado = validarEstadoReset({
    temToken: !!user.reset_token,
    expiresIso: user.reset_expires,
    tentativas: user.reset_attempts ?? 0,
  });
  if (!estado.ok) {
    // Mesmo em caso de estado inválido, incrementamos tentativas se houver token.
    if (user.reset_token) {
      db.prepare('UPDATE usuarios SET reset_attempts = reset_attempts + 1 WHERE id = ?').run(user.id);
    }
    logger.warn({ userId: user.id, motivo: estado.erro }, 'Tentativa de redefinição recusada');
    return { ok: false, error: estado.erro };
  }

  // Verifica o código de forma timing-safe (bcrypt.compareSync).
  if (!bcrypt.compareSync(input.codigo, user.reset_token!)) {
    const novasTentativas = (user.reset_attempts ?? 0) + 1;
    if (novasTentativas >= RESET_TENTATIVAS_MAX) {
      // Lockout: invalida o token para forçar novo pedido.
      db.prepare(
        'UPDATE usuarios SET reset_attempts = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?'
      ).run(novasTentativas, user.id);
      logger.warn({ userId: user.id }, 'Token de reset bloqueado após tentativas excessivas');
    } else {
      db.prepare('UPDATE usuarios SET reset_attempts = ? WHERE id = ?').run(novasTentativas, user.id);
      logger.warn({ userId: user.id, tentativas: novasTentativas }, 'Código de reset incorreto');
    }
    return { ok: false, error: 'Código incorreto.' };
  }

  // Sucesso: atualiza senha e limpa estado de reset.
  const novoHash = bcrypt.hashSync(input.novaSenha, 10);
  db.prepare(
    `UPDATE usuarios
     SET password_hash = ?, senha_temporaria = 0,
         reset_token = NULL, reset_expires = NULL, reset_attempts = 0,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(novoHash, user.id);

  logger.info({ userId: user.id }, 'Senha redefinida via token por e-mail');
  return { ok: true, data: true };
}

function escapeHtml(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function registrarRecuperacaoHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AUTH_SOLICITAR_RECUPERACAO, solicitarRecuperacao);
  ipcMain.handle(IPC_CHANNELS.AUTH_REDEFINIR_COM_TOKEN, redefinirComToken);
}
