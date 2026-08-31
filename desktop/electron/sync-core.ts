// ============================================================
// NÚCLEO DE SINCRONIZAÇÃO — funções puras (sem imports do Electron)
// ============================================================
// Compartilhado por cloud.ts (sync periódico/push acelerado) e
// realtime.ts (eventos postgres_changes). Manipulam diretamente o
// adapter SQLite (sql.js) aplicando mudanças vindas da nuvem.
//
// Regras de concorrência (last-write-wins):
//  - INSERT/UPDATE remoto só aplica se for ESTRITAMENTE mais novo
//    (updated_at) que a cópia local. Isso suprime o eco dos próprios
//    envios e evita sobrescrever edições locais mais recentes.
//  - DELETE remoto (tombstone) só aplica se a linha local não tiver
//    sido editada depois da exclusão.

export const TABELAS_SINCRONIZADAS = [
  'usuarios',
  'alunos',
  'docentes',
  'disciplinas',
  'historico_disciplinas',
  'declaracoes',
  'assinaturas',
  'diplomas',
  'atas_colacao',
  'cursos_livres',
  'curso_livre_alunos',
  'aluno_documentos',
  // Diploma Digital MEC (M2) — exigem supabase-diploma-digital.sql aplicado
  'ies',
  'cursos',
  'diplomas_digitais',
  'diploma_arquivos',
  'diploma_assinaturas',
  'auditoria_diploma',
] as const;

export type TabelaSincronizada = (typeof TABELAS_SINCRONIZADAS)[number];

// Colunas de flag: no SQLite local e no schema da nuvem (supabase-*.sql)
// são INTEGER (0/1) — NÃO boolean. Enviar `true`/`false` JSON para uma
// coluna INTEGER do Postgres falha com "invalid input syntax for type
// integer" e derruba o push da tabela inteira a cada ciclo (bug real:
// assinaturas/ies/cursos/declaracoes nunca subiam por isso). A conversão
// inversa (boolean remoto → 0/1 local) continua em aplicarLinhaRemota.
const FLAG_COLS = new Set(['ativo', 'enviado_web', 'convertido', 'valido_xsd']);
const TS_COLS = new Set(['created_at', 'updated_at', 'emitido_em']);

/** Converte timestamp ISO do Supabase para formato SQLite (mantém ms). */
export function isoToSqlite(v: unknown): string {
  if (typeof v !== 'string') return String(v);
  if (v.includes('T')) {
    return v.replace('T', ' ').replace(/\+00:00$/, '').replace(/Z$/, '');
  }
  return v;
}

/** Converte timestamp SQLite para ISO do Supabase */
export function sqliteToIso(v: unknown): string {
  if (typeof v !== 'string') return String(v);
  if (v && !v.includes('T') && v.includes(' ')) {
    return v.replace(' ', 'T') + 'Z';
  }
  return v;
}

/** Compara timestamps em qualquer um dos dois formatos (>0 se a>b) */
export function compararTs(a: string, b: string): number {
  const ta = new Date(a.includes('T') ? a : sqliteToIso(a)).getTime();
  const tb = new Date(b.includes('T') ? b : sqliteToIso(b)).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return ta - tb;
}

function colunasLocais(db: any, tabela: string): string[] {
  const cols = db.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[];
  return cols.map((c) => c.name);
}

/**
 * Aplica uma linha vinda da nuvem (INSERT ou UPDATE) no SQLite local.
 * Retorna true se escreveu algo (chamador deve notificar o renderer),
 * false se pulou (eco, stale ou inválida).
 */
export function aplicarLinhaRemota(db: any, tabela: string, row: Record<string, any>): boolean {
  if (!row || !TABELAS_SINCRONIZADAS.includes(tabela as TabelaSincronizada)) return false;
  if (row.id == null) return false;
  // O usuário admin local é próprio de cada instalação (senha local) — nunca sobrescrito.
  if (tabela === 'usuarios' && row.username === 'admin') return false;

  const localCols = colunasLocais(db, tabela);
  if (localCols.length === 0) return false;

  const cols = Object.keys(row).filter((k) => localCols.includes(k) && row[k] !== undefined);
  if (cols.length === 0) return false;
  const vals = cols.map((k) => {
    const v = row[k];
    if (v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (TS_COLS.has(k)) return isoToSqlite(v);
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  });

  // Last-write-wins: só aplica se o remoto for estritamente mais novo.
  if (localCols.includes('updated_at') && row.updated_at != null) {
    const local = db
      .prepare(`SELECT updated_at FROM ${tabela} WHERE id = ?`)
      .get(row.id) as { updated_at?: string } | undefined;
    if (local?.updated_at) {
      if (compararTs(local.updated_at, isoToSqlite(row.updated_at)) >= 0) return false;
    }
  }

  // Tombstone local mais novo que a linha: outra máquina pode ter re-enviado
  // (push stale) um registro que já foi excluído — ignora para não ressuscitar.
  // Uma re-criação legítima teria updated_at mais novo que o tombstone e passa.
  if (row.updated_at != null) {
    const tomb = db
      .prepare('SELECT deleted_at FROM delecoes WHERE tabela = ? AND id = ?')
      .get(tabela, row.id) as { deleted_at?: string } | undefined;
    if (tomb?.deleted_at && compararTs(tomb.deleted_at, isoToSqlite(row.updated_at)) >= 0) {
      return false;
    }
  }

  const placeholders = cols.map(() => '?').join(', ');
  const updateCols = cols.filter((c) => c !== 'id');
  if (updateCols.length > 0) {
    const updateSet = updateCols.map((c) => `${c} = excluded.${c}`).join(', ');
    db.prepare(
      `INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateSet}`
    ).run(...vals);
  } else {
    db.prepare(`INSERT OR IGNORE INTO ${tabela} (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
  }
  return true;
}

/**
 * Aplica um DELETE vindo da nuvem (evento realtime ou tombstone do pull).
 * O tombstone local NÃO é removido: ele permanece como defesa contra um
 * push stale de outra máquina que ainda não aplicou a exclusão (caso em que
 * a linha voltaria pelo pull/realtime e o tombstone a bloqueia). A poda por
 * idade (90 dias) limita o crescimento.
 * Retorna true se uma linha local foi removida.
 */
export function aplicarDeleteRemoto(db: any, tabela: string, id: number, deletedAt?: string): boolean {
  if (!TABELAS_SINCRONIZADAS.includes(tabela as TabelaSincronizada)) return false;
  // Edição local mais nova que a exclusão vence (last-write-wins).
  const cols = colunasLocais(db, tabela);
  if (deletedAt && cols.includes('updated_at')) {
    const local = db
      .prepare(`SELECT updated_at FROM ${tabela} WHERE id = ?`)
      .get(id) as { updated_at?: string } | undefined;
    if (local?.updated_at && compararTs(local.updated_at, isoToSqlite(deletedAt)) > 0) return false;
  }
  const info = db.prepare(`DELETE FROM ${tabela} WHERE id = ?`).run(id);
  return info.changes > 0;
}

export interface TombstoneRemoto {
  tabela: string;
  id: number;
  deleted_at: string;
}

/**
 * Aplica uma lista de tombstones vindos do Supabase (tabela `delecoes`).
 * Edição local mais nova que a exclusão vence (last-write-wins).
 * Retorna o conjunto de tabelas que tiveram linhas removidas.
 */
export function aplicarTombstonesRemotos(db: any, lista: TombstoneRemoto[]): Set<string> {
  const alteradas = new Set<string>();
  for (const t of lista) {
    if (!TABELAS_SINCRONIZADAS.includes(t.tabela as TabelaSincronizada)) continue;
    const local = db
      .prepare(`SELECT updated_at FROM ${t.tabela} WHERE id = ?`)
      .get(t.id) as { updated_at?: string } | undefined;
    if (local?.updated_at && compararTs(local.updated_at, isoToSqlite(t.deleted_at)) > 0) continue;
    if (aplicarDeleteRemoto(db, t.tabela, t.id)) alteradas.add(t.tabela);
  }
  return alteradas;
}

// ============================================================
// WATERMARK DE PUSH INCREMENTAL
// ============================================================
// Cada tabela guarda em `configuracoes` o timestamp (formato SQLite,
// UTC) do início do último push bem-sucedido. O próximo push envia
// apenas linhas com updated_at >= watermark (inclusivo: cobre corrida
// de mesma segunda). A coluna updated_at é mantida atualizada para
// TODA escrita local pelos triggers trg_bump_updated_at_* (database.ts).

const WM_PREFIXO = 'sync_push_wm_';

export function lerWatermarkPush(db: any, tabela: string): string | null {
  const row = db
    .prepare('SELECT valor FROM configuracoes WHERE chave = ?')
    .get(WM_PREFIXO + tabela) as { valor?: string } | undefined;
  return row?.valor ?? null;
}

export function salvarWatermarkPush(db: any, tabela: string, ts: string): void {
  db.prepare(
    `INSERT INTO configuracoes (chave, valor) VALUES (?, ?)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`
  ).run(WM_PREFIXO + tabela, ts);
}

/** Timestamp SQLite atual (UTC, com milissegundos — mesmo formato dos triggers). */
export function agoraSqlite(): string {
  return new Date().toISOString().replace('T', ' ').replace(/Z$/, '');
}

/** Seleciona linhas locais modificadas desde o watermark (ou todas). */
export function linhasParaPush(db: any, tabela: string, watermark: string | null): any[] {
  if (watermark === null) {
    return db.prepare(`SELECT * FROM ${tabela}`).all();
  }
  return db.prepare(`SELECT * FROM ${tabela} WHERE updated_at IS NULL OR updated_at >= ?`).all(watermark);
}

/** Converte uma linha SQLite no formato esperado pelo Supabase. */
export function linhaParaRemoto(row: Record<string, any>): Record<string, any> {
  const r: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined) continue;
    if (FLAG_COLS.has(k)) {
      // Flags são INTEGER (0/1) nos dois lados — nunca boolean (ver
      // comentário na definição de FLAG_COLS).
      r[k] = v === true ? 1 : v === false ? 0 : v;
    } else if (TS_COLS.has(k)) {
      r[k] = v === null ? null : sqliteToIso(String(v));
    } else {
      r[k] = v;
    }
  }
  return r;
}

// ============================================================
// INFRAESTRUTURA LOCAL (tombstones + bump de updated_at)
// ============================================================
// Instala no SQLite local tudo que o sync precisa:
//  1. Tabela `delecoes` (tombstones): trigger AFTER DELETE em cada tabela
//     sincronizada grava (tabela, id, deleted_at). O sync envia os
//     tombstones ao Supabase e remove as linhas remotas — sem isso, o PUSH
//     (upsert) não apaga nada remoto e o PULL seguinte "ressuscita" o
//     registro excluído.
//  2. Trigger de bump de updated_at: toda escrita local que não atualiza
//     explicitamente updated_at recebe um timestamp novo automaticamente.
//     Isso garante que o push incremental (watermark) nunca perca uma
//     mutação e mantém o last-write-wins correto entre máquinas.
//     Escritas que aplicam dados da nuvem trazem updated_at novo
//     (NEW != OLD → não dispara), preservando o timestamp remoto.
//
// PRECISÃO: os timestamps usam milissegundos (strftime %f). Granularidade
// de 1 segundo (datetime('now')) perde edições consecutivas no mesmo
// segundo — duas máquinas editando "ao mesmo tempo" gerariam timestamps
// iguais e o LWW as descartaria silenciosamente.

const TS_AGORA = "strftime('%Y-%m-%d %H:%M:%f', 'now')";

export function instalarInfraSincronizacao(db: any, tabelas: readonly string[]): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS delecoes (
      tabela TEXT NOT NULL,
      id INTEGER NOT NULL,
      deleted_at TEXT NOT NULL DEFAULT (${TS_AGORA}),
      origem TEXT NOT NULL DEFAULT 'local',
      PRIMARY KEY (tabela, id)
    );
  `);

  for (const t of tabelas) {
    const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    if (cols.length === 0) continue; // tabela inexistente localmente
    if (!cols.includes('updated_at')) {
      db.exec(`ALTER TABLE ${t} ADD COLUMN updated_at TEXT`);
      db.exec(`UPDATE ${t} SET updated_at = ${TS_AGORA} WHERE updated_at IS NULL`);
    }

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_delecoes_${t}
      AFTER DELETE ON ${t}
      BEGIN
        INSERT OR REPLACE INTO delecoes (tabela, id, deleted_at)
        VALUES ('${t}', OLD.id, ${TS_AGORA});
      END;
    `);

    // PRAGMA recursive_triggers é OFF por padrão no sql.js: o UPDATE interno
    // não re-dispara este trigger.
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_bump_updated_at_${t}
      AFTER UPDATE ON ${t}
      FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
      BEGIN
        UPDATE ${t} SET updated_at = ${TS_AGORA} WHERE id = NEW.id;
      END;
    `);
  }
}

/** Poda tombstones com mais de 90 dias (mesma retenção do Supabase). */
export function podarTombstones(db: any): void {
  db.prepare("DELETE FROM delecoes WHERE deleted_at < datetime('now', '-90 days')").run();
}
