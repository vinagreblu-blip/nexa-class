import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import { getDb } from '../database';
import { IPC_CHANNELS } from '../types';
import type { ApiResult } from '../types';
import { requerAdmin } from './auth';

export interface SmtpConfig {
  provedor: string;
  email: string;
  senha: string;
}

export const SMTP_PRESETS: Record<string, { host: string; port: number; label: string; ajuda: string }> = {
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

function obter(_event: IpcMainInvokeEvent): ApiResult<SmtpConfig | null> {
  const db = getDb();
  const row = db
    .prepare("SELECT valor FROM configuracoes WHERE chave = 'smtp'")
    .get() as { valor: string } | undefined;
  if (!row) return { ok: true, data: null };
  try {
    const cfg = JSON.parse(row.valor) as SmtpConfig;
    return { ok: true, data: { provedor: cfg.provedor, email: cfg.email, senha: cfg.senha } };
  } catch {
    return { ok: true, data: null };
  }
}

function salvar(
  _event: IpcMainInvokeEvent,
  config: SmtpConfig
): ApiResult<SmtpConfig> {
  if (!config.provedor || !SMTP_PRESETS[config.provedor]) {
    return { ok: false, error: 'Provedor inválido' };
  }
  if (!config.email?.trim()) {
    return { ok: false, error: 'E-mail é obrigatório' };
  }
  if (!config.senha?.trim()) {
    return { ok: false, error: 'Senha é obrigatória' };
  }
  const db = getDb();
  const valor = JSON.stringify({
    provedor: config.provedor.trim(),
    email: config.email.trim(),
    senha: config.senha.trim(),
  });
  db.prepare(
    `INSERT INTO configuracoes (chave, valor) VALUES ('smtp', ?)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`
  ).run(valor);
  return { ok: true, data: { provedor: config.provedor.trim(), email: config.email.trim(), senha: config.senha.trim() } };
}

/** Lê a config SMTP do banco (para uso por outros módulos, ex: recuperação de senha) */
export function obterSmtpConfig(): { host: string; port: number; user: string; pass: string; from: string } | null {
  const db = getDb();
  const row = db
    .prepare("SELECT valor FROM configuracoes WHERE chave = 'smtp'")
    .get() as { valor: string } | undefined;
  if (!row) return null;
  try {
    const cfg = JSON.parse(row.valor) as SmtpConfig;
    const preset = SMTP_PRESETS[cfg.provedor];
    if (!preset) return null;
    return {
      host: preset.host,
      port: preset.port,
      user: cfg.email,
      pass: cfg.senha,
      from: cfg.email,
    };
  } catch {
    return null;
  }
}

export function registrarSmtpHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SMTP_OBTER, requerAdmin(obter));
  ipcMain.handle(IPC_CHANNELS.SMTP_SALVAR, requerAdmin(salvar));
}
