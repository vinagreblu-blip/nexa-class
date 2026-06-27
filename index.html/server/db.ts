import path from 'node:path';
import { openDatabase, type DbAdapter } from './sqlite-adapter';

export interface DeclaracaoRegistrada {
  codigo_verificacao: string;
  hash_conteudo: string;
  dados_aluno: {
    nome: string;
    matricula: string;
    curso: string | null;
    cpf: string | null;
  };
  emitido_em: string;
  verificado_em: string | null;
}

let db: DbAdapter;

export async function initDb(): Promise<DbAdapter> {
  const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'verificacao.sqlite');
  db = await openDatabase(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS declaracoes (
      codigo_verificacao TEXT PRIMARY KEY,
      hash_conteudo TEXT NOT NULL,
      dados_aluno TEXT NOT NULL,
      emitido_em TEXT NOT NULL,
      verificado_em TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

function getDb(): DbAdapter {
  if (!db) throw new Error('Database não inicializado');
  return db;
}

export function registrarDeclaracao(input: DeclaracaoRegistrada): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO declaracoes
       (codigo_verificacao, hash_conteudo, dados_aluno, emitido_em, verificado_em)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      input.codigo_verificacao,
      input.hash_conteudo,
      JSON.stringify(input.dados_aluno),
      input.emitido_em,
      null
    );
}

export function buscarDeclaracao(codigo: string): DeclaracaoRegistrada | null {
  const row = getDb()
    .prepare('SELECT * FROM declaracoes WHERE codigo_verificacao = ?')
    .get(codigo) as
    | {
        codigo_verificacao: string;
        hash_conteudo: string;
        dados_aluno: string;
        emitido_em: string;
        verificado_em: string | null;
      }
    | undefined;

  if (!row) return null;
  return {
    codigo_verificacao: row.codigo_verificacao,
    hash_conteudo: row.hash_conteudo,
    dados_aluno: JSON.parse(row.dados_aluno),
    emitido_em: row.emitido_em,
    verificado_em: row.verificado_em,
  };
}

export function marcarVerificado(codigo: string): void {
  getDb()
    .prepare(
      'UPDATE declaracoes SET verificado_em = datetime(\'now\') WHERE codigo_verificacao = ?'
    )
    .run(codigo);
}

export function removerDeclaracao(codigo: string): { changes: number } {
  return getDb()
    .prepare('DELETE FROM declaracoes WHERE codigo_verificacao = ?')
    .run(codigo);
}
