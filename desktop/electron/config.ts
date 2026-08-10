import { app } from 'electron';
import path from 'node:path';
import { getLocalIP } from './network';

// Detecta IP local uma vez ao carregar (para QR Code acessível por celular na mesma rede)
const LOCAL_IP = getLocalIP();
const VERIFICACAO_PORT = 3001;

export const CONFIG = {
  VERIFICACAO_BASE_URL: process.env.VERIFICACAO_BASE_URL ?? `http://${LOCAL_IP}:${VERIFICACAO_PORT}`,
  VERIFICACAO_API_KEY: process.env.VERIFICACAO_API_KEY ?? 'nexa-dev-api-key-trocar',
  ADMIN_SEED: {
    username: process.env.ADMIN_USERNAME ?? 'admin',
    nome: process.env.ADMIN_NOME ?? 'Administrador',
    // Senha inicial do admin local. Se ADMIN_PASSWORD estiver no ambiente (ex.:
    // build controlado), usa-a; caso contrário o seedAdmin gera uma senha forte
    // aleatória por instalação e a salva em userData/credenciais-iniciais.txt.
    // Nunca há uma senha padrão pública no código.
    password: process.env.ADMIN_PASSWORD ?? '',
  },
  // Hash bcrypt da senha master exigida para excluir declarações, resetar usuários,
  // editar docentes/disciplinas e acessar cursos livres.
  // Independente da senha de login do admin.
  // Para rotacionar: gere um novo hash com `bcrypt.hashSync('<nova>', 10)` e sete
  // SENHA_EXCLUSAO_DECLARACAO_HASH no ambiente. Nunca commitar o plaintext.
  SENHA_EXCLUSAO_DECLARACAO_HASH:
    process.env.SENHA_EXCLUSAO_DECLARACAO_HASH ??
    '$2a$10$nhrugU7YCD/.p3x7HgNTEeRKpIRZAAX0OVW0Qz0Bg1BPGxyxrYZpq',
  APP_NAME: 'NEXA CLASS',
  INSTITUICAO: 'NEXA CLASS - Network for Education and Academic Excellence Class',
  // Configuração SMTP para envio de e-mails (recuperação de senha)
  SMTP: {
    host: process.env.SMTP_HOST ?? '',
    // Number('') == 0, Number('abc') == NaN. Usar || para tratar ambos como fallback.
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? '',
  },
  RESET_SERVER_PORT: process.env.RESET_SERVER_PORT ? Number(process.env.RESET_SERVER_PORT) : 3456,
} as const;

export function getDbPath(): string {
  const userData = app.getPath('userData');
  return path.join(userData, 'nexa-class.sqlite');
}

export function getDbPathAntigo(): string {
  const userData = app.getPath('userData');
  return path.join(userData, 'erich-fromm.sqlite');
}

export function getDbPathAntigo2(): string {
  const userData = app.getPath('userData');
  return path.join(userData, 'nexa.sqlite');
}
