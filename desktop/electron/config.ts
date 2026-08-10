import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getLocalIP } from './network';
import { logger } from './utils/logger';

// Detecta IP local uma vez ao carregar (para QR Code acessível por celular na mesma rede)
const LOCAL_IP = getLocalIP();
const VERIFICACAO_PORT = 3001;

/**
 * API key default pública — conhecida por qualquer um com acesso ao código.
 * Usada APENAS em desenvolvimento para conveniência. Em produção (app packaged)
 * o getter VERIFICACAO_API_KEY ignora esse valor e gera/persiste uma key forte.
 */
export const DEFAULT_API_KEY = 'nexa-dev-api-key-trocar';

const API_KEY_FILENAME = 'api-key.txt';
const SENHA_MASTER_FILENAME = 'senha-master.txt';

let apiKeyCache: string | null = null;

/**
 * Resolve a API key de verificação com fallback seguro.
 *
 * Ordem:
 *  1. process.env.VERIFICACAO_API_KEY (se setada e != default) — deploy controlado
 *  2. userData/api-key.txt (lê key persistida de runs anteriores)
 *  3. gera 32 bytes aleatórios, persiste em userData/api-key.txt (mode 0600) e usa
 *
 * A key gerada é compartilhada entre o client (declaracao.ts/historico.ts) e o
 * servidor embarcado (servico-verificacao.ts) automaticamente, sem ação do
 * operador. Em deploy com o serviço standalone (verificacao-web/), o operador
 * precisa setar VERIFICACAO_API_KEY no desktop = API_KEY no serviço web.
 */
function resolveApiKey(): string {
  if (apiKeyCache) return apiKeyCache;

  const fromEnv = process.env.VERIFICACAO_API_KEY;
  if (fromEnv && fromEnv !== DEFAULT_API_KEY) {
    apiKeyCache = fromEnv;
    return fromEnv;
  }

  // Em dev, mantém o default para não poluir o userData e facilitar debugging.
  const isDev = !app.isPackaged;
  if (isDev) {
    apiKeyCache = DEFAULT_API_KEY;
    return DEFAULT_API_KEY;
  }

  // Produção: lê ou gera a key persistida em userData.
  const keyPath = path.join(app.getPath('userData'), API_KEY_FILENAME);
  try {
    if (fs.existsSync(keyPath)) {
      const persisted = fs.readFileSync(keyPath, 'utf8').trim();
      if (persisted && persisted !== DEFAULT_API_KEY) {
        apiKeyCache = persisted;
        return persisted;
      }
    }
  } catch (e: any) {
    logger.warn({ err: e }, 'Falha ao ler API key persistida');
  }

  // Gera nova key forte e persiste.
  const generated = randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, generated, { mode: 0o600 });
    logger.info({ path: keyPath }, 'API key de verificação gerada e persistida');
  } catch (e: any) {
    // Se falhar ao persistir, usamos a gerada em memória (será regenerada no próximo boot).
    logger.warn({ err: e }, 'Falha ao persistir API key');
  }
  apiKeyCache = generated;
  return generated;
}

let senhaMasterHashCache: string | null = null;

/**
 * Resolve o hash bcrypt da senha master exigida para excluir declarações,
 * resetar usuários, editar docentes/disciplinas e acessar cursos livres.
 *
 * Antes: hash hardcoded público no repo. Qualquer um com o repo podia tentar
 * brute-force offline. Agora:
 *
 * Ordem em produção (app packaged):
 *  1. process.env.SENHA_EXCLUSAO_DECLARACAO_HASH — deploy controlado pelo operador
 *  2. userData/senha-master.txt contendo o hash + plaintext (admin lê a senha)
 *  3. Gera senha aleatória forte, persiste hash + plaintext e usa
 *
 * Em dev: usa o hash legacy público (conveniência, senha "master-dev").
 */
export const SENHA_MASTER_DEV_HASH =
  '$2a$10$nhrugU7YCD/.p3x7HgNTEeRKpIRZAAX0OVW0Qz0Bg1BPGxyxrYZpq';

function resolveSenhaMasterHash(): string {
  if (senhaMasterHashCache) return senhaMasterHashCache;

  const fromEnv = process.env.SENHA_EXCLUSAO_DECLARACAO_HASH;
  if (fromEnv && fromEnv !== SENHA_MASTER_DEV_HASH) {
    senhaMasterHashCache = fromEnv;
    return fromEnv;
  }

  const isDev = !app.isPackaged;
  if (isDev) {
    senhaMasterHashCache = SENHA_MASTER_DEV_HASH;
    return SENHA_MASTER_DEV_HASH;
  }

  // Produção: lê ou gera a senha master persistida.
  const senhaPath = path.join(app.getPath('userData'), SENHA_MASTER_FILENAME);
  try {
    if (fs.existsSync(senhaPath)) {
      const conteudo = fs.readFileSync(senhaPath, 'utf8');
      // Arquivo tem formato: "hash: <bcrypt-hash>" / "senha: <plaintext>".
      const match = conteudo.match(/^hash:\s*(\S+)/m);
      if (match && match[1] && match[1] !== SENHA_MASTER_DEV_HASH) {
        senhaMasterHashCache = match[1];
        return match[1];
      }
    }
  } catch (e: any) {
    logger.warn({ err: e }, 'Falha ao ler senha master persistida');
  }

  // Gera nova senha master forte.
  const senhaPlaintext = randomBytes(12).toString('base64url').slice(0, 16);
  const novoHash = bcrypt.hashSync(senhaPlaintext, 10);
  try {
    fs.mkdirSync(path.dirname(senhaPath), { recursive: true });
    const conteudo =
      `NEXA CLASS — senha master\n` +
      `Esta senha é exigida para operações críticas: excluir declarações,\n` +
      `resetar usuários, editar docentes/disciplinas, acessar cursos livres.\n\n` +
      `hash: ${novoHash}\n` +
      `senha: ${senhaPlaintext}\n\n` +
      `Guarde em local seguro. Você pode apagar este arquivo após anotar a senha.\n`;
    fs.writeFileSync(senhaPath, conteudo, { mode: 0o600 });
    logger.info({ path: senhaPath }, 'Senha master gerada e persistida');
  } catch (e: any) {
    logger.warn({ err: e }, 'Falha ao persistir senha master');
  }
  senhaMasterHashCache = novoHash;
  return novoHash;
}

export const CONFIG = {
  // Getters lazy: só chamam app.getPath('userData') no primeiro acesso
  // (sempre depois de app.whenReady()).
  get VERIFICACAO_API_KEY(): string {
    return resolveApiKey();
  },
  VERIFICACAO_BASE_URL: process.env.VERIFICACAO_BASE_URL ?? `http://${LOCAL_IP}:${VERIFICACAO_PORT}`,
  ADMIN_SEED: {
    username: process.env.ADMIN_USERNAME ?? 'admin',
    nome: process.env.ADMIN_NOME ?? 'Administrador',
    // Senha inicial do admin local. Se ADMIN_PASSWORD estiver no ambiente (ex.:
    // build controlado), usa-a; caso contrário o seedAdmin gera uma senha forte
    // aleatória por instalação e a salva em userData/credenciais-iniciais.txt.
    // Nunca há uma senha padrão pública no código.
    password: process.env.ADMIN_PASSWORD ?? '',
  },
  // Hash bcrypt da senha master. Em produção é gerado/persistido por instalação
  // — ver resolveSenhaMasterHash() acima. Em dev usa hash público legacy.
  get SENHA_EXCLUSAO_DECLARACAO_HASH(): string {
    return resolveSenhaMasterHash();
  },
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
