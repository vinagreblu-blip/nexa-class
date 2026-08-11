import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain, app } from 'electron';
import { getDb } from '../database';
import { IPC_CHANNELS } from '../types';
import type { ApiResult } from '../types';
import { requerAdmin } from './auth';
import { obterSmtpConfig } from './smtp';
import { obterStatusCloud, obterStatusAuth, listarInstalacoes, revogarInstalacao } from '../cloud';
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
    /** Últimos usuários modificados (proxy para "ativos recentemente"). */
    usuarios: Array<{ username: string; nome: string; role: string; updated_at: string | null }>;
    /** Últimas declarações emitidas. */
    declaracoes: Array<{
      emitido_em: string;
      aluno_nome: string;
      aluno_matricula: string;
      emitido_por_nome: string;
    }>;
    /** Últimos alunos cadastrados (em qualquer máquina sincronizada). */
    alunos: Array<{
      nome: string;
      matricula: string;
      curso: string | null;
      created_at: string | null;
      cadastrado_por_nome: string | null;
    }>;
    /** Últimos diplomas emitidos. */
    diplomas: Array<{
      emitido_em: string;
      aluno_nome: string;
      aluno_matricula: string;
      emitido_por_nome: string;
    }>;
    /** Últimas atas de colação. */
    atas: Array<{
      emitido_em: string | null;
      aluno_nome: string;
      aluno_matricula: string;
    }>;
    /** Últimos cursos livres criados. */
    cursosLivres: Array<{
      nome: string;
      carga_horaria: string | null;
      created_at: string;
    }>;
    /** Últimas matrículas em cursos livres. */
    matriculasCursosLivres: Array<{
      created_at: string;
      curso_nome: string;
      aluno_nome: string;
      aluno_matricula: string;
    }>;
  };
  status: {
    cloudSync: { ativo: boolean; ultimoSyncEm: string | null; ultimoSyncOk: boolean | null };
    cloudAuth: {
      autenticado: boolean;
      identityEmail: string | null;
      machineId: string | null;
      ultimoErro: string | null;
      revogada: boolean;
    };
    smtp: boolean;
    sentry: boolean;
    apiKeyForte: boolean;
    senhaMasterForte: boolean;
    /** Tamanho do dir userData em bytes. */
    userDataBytes: number;
    /** Versão do app (package.json). */
    appVersao: string;
  };
  /** Máquinas com acesso à nuvem (painel de revogação). */
  instalacoes: Array<{
    machine_id: string;
    hostname: string | null;
    app_versao: string | null;
    identity_email: string | null;
    revoked: number;
    last_seen: string | null;
  }>;
}

/** Quantos itens aparecem em cada lista de atividade recente. */
const LIMITE_ATIVIDADE = 10;

/**
 * Lê as métricas do DB. Função pura em relação a electron/global state —
 * recebe o db e config para permitir testes.
 */
export function obterMetricas(db: ReturnType<typeof getDb>): Omit<MetricasDashboard, 'status' | 'instalacoes'> {
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
         LIMIT ?`
      )
      .all(LIMITE_ATIVIDADE) as MetricasDashboard['atividadeRecente']['usuarios'],
    declaracoes: db
      .prepare(
        `SELECT d.emitido_em, a.nome AS aluno_nome, a.matricula AS aluno_matricula,
                u.nome AS emitido_por_nome
         FROM declaracoes d
         JOIN alunos a ON a.id = d.aluno_id
         JOIN usuarios u ON u.id = d.emitido_por
         ORDER BY d.emitido_em DESC
         LIMIT ?`
      )
      .all(LIMITE_ATIVIDADE) as MetricasDashboard['atividadeRecente']['declaracoes'],
    alunos: db
      .prepare(
        `SELECT a.nome, a.matricula, a.curso, a.created_at,
                u.nome AS cadastrado_por_nome
         FROM alunos a
         LEFT JOIN usuarios u ON u.id = a.created_by
         ORDER BY COALESCE(a.created_at, '1970-01-01') DESC
         LIMIT ?`
      )
      .all(LIMITE_ATIVIDADE) as MetricasDashboard['atividadeRecente']['alunos'],
    diplomas: db
      .prepare(
        `SELECT d.emitido_em, a.nome AS aluno_nome, a.matricula AS aluno_matricula,
                u.nome AS emitido_por_nome
         FROM diplomas d
         JOIN alunos a ON a.id = d.aluno_id
         JOIN usuarios u ON u.id = d.emitido_por
         ORDER BY d.emitido_em DESC
         LIMIT ?`
      )
      .all(LIMITE_ATIVIDADE) as MetricasDashboard['atividadeRecente']['diplomas'],
    atas: db
      .prepare(
        `SELECT at.emitido_em, a.nome AS aluno_nome, a.matricula AS aluno_matricula
         FROM atas_colacao at
         JOIN alunos a ON a.id = at.aluno_id
         ORDER BY COALESCE(at.emitido_em, at.created_at) DESC
         LIMIT ?`
      )
      .all(LIMITE_ATIVIDADE) as MetricasDashboard['atividadeRecente']['atas'],
    cursosLivres: db
      .prepare(
        `SELECT nome, carga_horaria, created_at
         FROM cursos_livres
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(LIMITE_ATIVIDADE) as MetricasDashboard['atividadeRecente']['cursosLivres'],
    matriculasCursosLivres: db
      .prepare(
        `SELECT cla.created_at, cl.nome AS curso_nome,
                a.nome AS aluno_nome, a.matricula AS aluno_matricula
         FROM curso_livre_alunos cla
         JOIN cursos_livres cl ON cl.id = cla.curso_livre_id
         JOIN alunos a ON a.id = cla.aluno_id
         ORDER BY cla.created_at DESC
         LIMIT ?`
      )
      .all(LIMITE_ATIVIDADE) as MetricasDashboard['atividadeRecente']['matriculasCursosLivres'],
  };

  return { contadores, atividadeRecente };
}

async function obter(_event: IpcMainInvokeEvent): Promise<ApiResult<MetricasDashboard>> {
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
    cloudAuth: obterStatusAuth(),
    smtp: obterSmtpConfig() !== null,
    sentry,
    apiKeyForte,
    senhaMasterForte,
    userDataBytes,
    appVersao,
  };

  // Lista de máquinas (falha silenciosa se a nuvem estiver offline).
  const instalacoes = await listarInstalacoes().catch(() => []);

  return { ok: true, data: { ...base, status, instalacoes } };
}

async function revogar(
  _event: IpcMainInvokeEvent,
  machineId: string
): Promise<ApiResult<true>> {
  const res = await revogarInstalacao(machineId);
  if (!res.ok) return { ok: false, error: res.erro ?? 'Falha ao revogar' };
  return { ok: true, data: true };
}

export function registrarDashboardHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OBTER, requerAdmin(obter));
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_REVOGAR, requerAdmin(revogar));
}
