-- Schema de referência do banco SQLite do app desktop (Erich Fromm)
-- Observação: este schema é aplicado automaticamente em electron/database.ts (createSchema).
-- Este arquivo serve como documentação de referência.

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nome TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operador' CHECK (role IN ('admin','operador')),
  ativo INTEGER NOT NULL DEFAULT 1,
  senha_temporaria INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alunos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matricula TEXT UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  cpf TEXT,
  rg TEXT,
  nacionalidade TEXT,
  naturalidade TEXT,
  cidade TEXT,
  sexo TEXT,
  email TEXT,
  telefone TEXT,
  curso TEXT,
  faculdade TEXT,
  ano_ingresso TEXT,
  ano_conclusao TEXT,
  data_nascimento TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS declaracoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  aluno_id INTEGER NOT NULL,
  codigo_verificacao TEXT UNIQUE NOT NULL,
  hash_conteudo TEXT NOT NULL,
  emitido_por INTEGER NOT NULL,
  emitido_em TEXT NOT NULL DEFAULT (datetime('now')),
  enviado_web INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE,
  FOREIGN KEY (emitido_por) REFERENCES usuarios(id)
);

CREATE INDEX IF NOT EXISTS idx_alunos_matricula ON alunos(matricula);
CREATE INDEX IF NOT EXISTS idx_alunos_nome ON alunos(nome);
CREATE INDEX IF NOT EXISTS idx_declaracoes_aluno ON declaracoes(aluno_id);
CREATE INDEX IF NOT EXISTS idx_declaracoes_codigo ON declaracoes(codigo_verificacao);
