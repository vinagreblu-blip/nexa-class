-- ============================================================
-- NEXA CLASS — Schema Supabase (PostgreSQL) — VERSÃO CORRIGIDA
-- Cole TODO este conteúdo no SQL Editor do Supabase e rode
-- ============================================================

-- Habilita UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabela: usuarios
CREATE TABLE IF NOT EXISTS usuarios (
  id BIGSERIAL PRIMARY KEY,
  codigo TEXT UNIQUE,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nome TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'operador' CHECK (role IN ('admin','operador')),
  foto_path TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  senha_temporaria INTEGER NOT NULL DEFAULT 0,
  reset_token TEXT,
  reset_expires TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migração para installs Supabase já existentes (rode uma vez no SQL Editor):
-- ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_temporaria INTEGER NOT NULL DEFAULT 0;

-- Tabela: alunos
CREATE TABLE IF NOT EXISTS alunos (
  id BIGSERIAL PRIMARY KEY,
  matricula TEXT UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  cpf TEXT,
  rg TEXT,
  nacionalidade TEXT,
  naturalidade TEXT,
  cidade TEXT,
  sexo TEXT,
  orgao_emissor TEXT,
  turno TEXT,
  forma_ingresso TEXT,
  data_vestibular TEXT,
  data_colacao TEXT,
  email TEXT,
  telefone TEXT,
  curso TEXT,
  faculdade TEXT,
  ano_ingresso TEXT,
  ano_conclusao TEXT,
  data_nascimento TEXT,
  created_by BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela: docentes
CREATE TABLE IF NOT EXISTS docentes (
  id BIGSERIAL PRIMARY KEY,
  nome TEXT UNIQUE NOT NULL,
  titulacao TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela: disciplinas
CREATE TABLE IF NOT EXISTS disciplinas (
  id BIGSERIAL PRIMARY KEY,
  nome TEXT UNIQUE NOT NULL,
  docente_id BIGINT REFERENCES docentes(id) ON DELETE SET NULL,
  ch TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela: historico_disciplinas
CREATE TABLE IF NOT EXISTS historico_disciplinas (
  id BIGSERIAL PRIMARY KEY,
  aluno_id BIGINT NOT NULL REFERENCES alunos(id) ON DELETE CASCADE,
  periodo TEXT NOT NULL,
  disciplina TEXT NOT NULL,
  docente TEXT,
  titulacao TEXT,
  ch TEXT,
  nota TEXT,
  ft TEXT,
  status TEXT,
  ordem INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela: declaracoes
CREATE TABLE IF NOT EXISTS declaracoes (
  id BIGSERIAL PRIMARY KEY,
  aluno_id BIGINT NOT NULL REFERENCES alunos(id) ON DELETE CASCADE,
  codigo_verificacao TEXT UNIQUE NOT NULL,
  hash_conteudo TEXT NOT NULL,
  emitido_por BIGINT NOT NULL,
  emitido_em TIMESTAMPTZ DEFAULT NOW(),
  enviado_web INTEGER NOT NULL DEFAULT 0,
  pdf_caminho TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela: assinaturas
CREATE TABLE IF NOT EXISTS assinaturas (
  id BIGSERIAL PRIMARY KEY,
  nome_signatario TEXT NOT NULL,
  cargo TEXT NOT NULL,
  imagem_path TEXT,
  certificado_path TEXT,
  certificado_tipo TEXT,
  certificado_a3_thumbprint TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migração para installs já existentes (rode uma vez no SQL Editor):
-- ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS certificado_tipo TEXT;
-- ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS certificado_a3_thumbprint TEXT;

-- Tabela: diplomas
CREATE TABLE IF NOT EXISTS diplomas (
  id BIGSERIAL PRIMARY KEY,
  aluno_id BIGINT NOT NULL REFERENCES alunos(id) ON DELETE CASCADE,
  codigo_verificacao TEXT UNIQUE NOT NULL,
  hash_conteudo TEXT NOT NULL,
  emitido_por BIGINT NOT NULL,
  emitido_em TIMESTAMPTZ DEFAULT NOW(),
  enviado_web INTEGER NOT NULL DEFAULT 0,
  pdf_caminho TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela: atas_colacao
CREATE TABLE IF NOT EXISTS atas_colacao (
  id BIGSERIAL PRIMARY KEY,
  aluno_id BIGINT NOT NULL UNIQUE REFERENCES alunos(id) ON DELETE CASCADE,
  numero_ata TEXT,
  data TEXT,
  horario TEXT,
  plataforma TEXT,
  instituicao TEXT,
  cidade TEXT,
  estado TEXT,
  grau TEXT,
  modalidade TEXT,
  presidente_nome TEXT,
  presidente_cargo TEXT,
  diretor_nome TEXT,
  diretor_cargo TEXT,
  pdf_caminho TEXT,
  emitido_por BIGINT,
  emitido_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela: cursos_livres
CREATE TABLE IF NOT EXISTS cursos_livres (
  id BIGSERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT,
  carga_horaria TEXT,
  data_inicio TEXT,
  data_fim TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela: curso_livre_alunos
CREATE TABLE IF NOT EXISTS curso_livre_alunos (
  id BIGSERIAL PRIMARY KEY,
  curso_livre_id BIGINT NOT NULL REFERENCES cursos_livres(id) ON DELETE CASCADE,
  aluno_id BIGINT NOT NULL REFERENCES alunos(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (curso_livre_id, aluno_id)
);

-- Tabela: aluno_documentos
CREATE TABLE IF NOT EXISTS aluno_documentos (
  id BIGSERIAL PRIMARY KEY,
  aluno_id BIGINT NOT NULL REFERENCES alunos(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  caminho TEXT NOT NULL,
  xml_path TEXT,
  convertido INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RLS (Row Level Security)
-- ============================================================
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE alunos ENABLE ROW LEVEL SECURITY;
ALTER TABLE docentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE disciplinas ENABLE ROW LEVEL SECURITY;
ALTER TABLE historico_disciplinas ENABLE ROW LEVEL SECURITY;
ALTER TABLE declaracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE assinaturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE diplomas ENABLE ROW LEVEL SECURITY;
ALTER TABLE atas_colacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE cursos_livres ENABLE ROW LEVEL SECURITY;
ALTER TABLE curso_livre_alunos ENABLE ROW LEVEL SECURITY;
ALTER TABLE aluno_documentos ENABLE ROW LEVEL SECURITY;

-- Remove políticas antigas (se existirem) antes de criar
DROP POLICY IF EXISTS "allow_all" ON usuarios;
DROP POLICY IF EXISTS "allow_all" ON alunos;
DROP POLICY IF EXISTS "allow_all" ON docentes;
DROP POLICY IF EXISTS "allow_all" ON disciplinas;
DROP POLICY IF EXISTS "allow_all" ON historico_disciplinas;
DROP POLICY IF EXISTS "allow_all" ON declaracoes;
DROP POLICY IF EXISTS "allow_all" ON assinaturas;
DROP POLICY IF EXISTS "allow_all" ON diplomas;
DROP POLICY IF EXISTS "allow_all" ON atas_colacao;
DROP POLICY IF EXISTS "allow_all" ON cursos_livres;
DROP POLICY IF EXISTS "allow_all" ON curso_livre_alunos;
DROP POLICY IF EXISTS "allow_all" ON aluno_documentos;

-- Cria políticas novas
CREATE POLICY "allow_all" ON usuarios FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON alunos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON docentes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON disciplinas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON historico_disciplinas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON declaracoes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON assinaturas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON diplomas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON atas_colacao FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON cursos_livres FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON curso_livre_alunos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON aluno_documentos FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Tabela: arquivos (sync de DB + assinaturas entre máquinas)
-- ============================================================
CREATE TABLE IF NOT EXISTS arquivos (
  caminho TEXT PRIMARY KEY,
  dados TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE arquivos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON arquivos;
CREATE POLICY "allow_all" ON arquivos FOR ALL USING (true) WITH CHECK (true);
