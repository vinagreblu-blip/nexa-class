import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain, app } from 'electron';
import { getDb } from '../database';
import { IPC_CHANNELS } from '../types';
import type { ApiResult } from '../types';
import { requerAdmin } from './auth';
import { obterSmtpConfig } from './smtp';
import { obterStatusCloud } from '../cloud';
import { CONFIG, DEFAULT_API_KEY, SENHA_MASTER_DEV_HASH } from '../config';
import { deveIniciarSentry } from '../sentry-config';
import { calcularTamanhoDiretorio } from '../utils/sistema';

/**
 * Métricas exibidas no Dashboard admin.
 * Contadores, atividade recente e status do sistema.
 */
export interface MetricasDashboard {
  contadores: {
    alunos: number;
    usuariosAtivos: number;
    declaracoes: number;
    diplomas: number;
    docentes: number;
    disciplinas: number;
    cursosLivres: number;
  };
  atividadeRecente: {
    /** Últimos 5 usuários modificados (proxy para "ativos recentemente"). */
    usuarios: Array<{ username: string; nome: string; role: string; updated_at: string | null }>;
    /** Últimas 5 declarações emitidas. */
    declaracoes: Array<{
      emitido_em: string;
      aluno_nome: string;
      aluno_matricula: string;
      emitido_por_nome: string;
    }>;
  };
  status: {
    cloudSync: { ativo: boolean; ultimoSyncEm: string | null; ultimoSyncOk: boolean | null };
    smtp: boolean;
    sentry: boolean;
    apiKeyForte: boolean;
    senhaMasterForte: boolean;
    /** Tamanho do dir userData em bytes. */
    userDataBytes: number;
    /** Versão do app (package.json). */
    appVersao: string;
  };
}

/**
 * Lê as métricas do DB. Função pura em relação a electron/global state —
 * recebe o db e config para permitir testes.
 */
export function obterMetricas(db: ReturnType<typeof getDb>): Omit<MetricasDashboard, 'status'> {
  const contadores = {
    alunos: (db.prepare('SELECT COUNT(*) AS n FROM alunos').get() as { n: number }).n,
    usuariosAtivos: (
      db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE ativo = 1').get() as { n: number }
    ).n,
    declaracoes: (db.prepare('SELECT COUNT(*) AS n FROM declaracoes').get() as { n: number }).n,
    diplomas: (db.prepare('SELECT COUNT(*) AS n FROM diplomas').get() as { n: number }).n,
    docentes: (db.prepare('SELECT COUNT(*) AS n FROM docentes').get() as { n: number }).n,
    disciplinas: (db.prepare('SELECT COUNT(*) AS n FROM disciplinas').get() as { n: number }).n,
    cursosLivres: (db.prepare('SELECT COUNT(*) AS n FROM cursos_livres').get() as { n: number }).n,
  };

  const atividadeRecente = {
    usuarios: db
      .prepare(
        `SELECT username, nome, role, updated_at
         FROM usuarios WHERE ativo = 1
         ORDER BY COALESCE(updated_at, '1970-01-01') DESC
         LIMIT 5`
      )
      .all() as MetricasDashboard['atividadeRecente']['usuarios'],
    declaracoes: db
      .prepare(
        `SELECT d.emitido_em, a.nome AS aluno_nome, a.matricula AS aluno_matricula,
                u.nome AS emitido_por_nome
         FROM declaracoes d
         JOIN alunos a ON a.id = d.aluno_id
         JOIN usuarios u ON u.id = d.emitido_por
         ORDER BY d.emitido_em DESC
         LIMIT 5`
      )
      .all() as MetricasDashboard['atividadeRecente']['declaracoes'],
  };

  return { contadores, atividadeRecente };
}

function obter(_event: IpcMainInvokeEvent): ApiResult<MetricasDashboard> {
  const db = getDb();
  const base = obterMetricas(db);

  // app.getVersion() lê do package.json do app (versão real).
  const appVersao = app.getVersion();

  const userDataBytes = calcularTamanhoDiretorio(app.getPath('userData'));

  // API key forte: diferente do default público.
  const apiKeyForte = CONFIG.VERIFICACAO_API_KEY !== DEFAULT_API_KEY;

  // Senha master forte: diferente do hash dev público (em produção é gerada por instalação).
  const senhaMasterForte = CONFIG.SENHA_EXCLUSAO_DECLARACAO_HASH !== SENHA_MASTER_DEV_HASH;

  // Sentry ativo: env SENTRY_DSN configurada E passou na validação.
  const sentry =
    deveIniciarSentry({ dsn: process.env.SENTRY_DSN }) === null && !!process.env.SENTRY_DSN;

  const status: MetricasDashboard['status'] = {
    cloudSync: obterStatusCloud(),
    smtp: obterSmtpConfig() !== null,
    sentry,
    apiKeyForte,
    senhaMasterForte,
    userDataBytes,
    appVersao,
  };

  return { ok: true, data: { ...base, status } };
}

export function registrarDashboardHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OBTER, requerAdmin(obter));
}
