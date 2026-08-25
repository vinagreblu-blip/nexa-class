-- ============================================================
-- NEXA CLASS — Diploma Digital MEC: schema da nuvem (v1.05)
-- ============================================================
-- Aplique no SQL Editor do Supabase DEPOIS de:
--   supabase-schema.sql / migration-rls.sql / rls-auth.sql /
--   realtime.sql / pdf-sync.sql
--
-- Cria as 6 tabelas do módulo de Diploma Digital (espelho das
-- tabelas locais de desktop/electron/database.ts), policies
-- `authenticated` (mesmo padrão das 12 operacionais), realtime
-- e o bucket PRIVADO de Storage para os XMLs/PDFs oficiais
-- (acesso apenas via URL assinada — nunca público).
--
-- NÃO sincronizar ainda: as tabelas só entram em
-- TABELAS_SINCRONIZADAS (sync-core.ts) na frente de trabalho M2,
-- depois deste script aplicado. Idempotente.
-- ============================================================

-- ---------------------------------------------------------
-- 1) Tabelas (espelham o SQLite local; JSON vira TEXT/JSONB)
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS ies (
  id BIGSERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  codigo_emec INTEGER,
  cnpj TEXT,
  logradouro TEXT,
  numero TEXT,
  complemento TEXT,
  bairro TEXT,
  codigo_municipio TEXT,
  nome_municipio TEXT,
  uf TEXT,
  cep TEXT,
  papel TEXT NOT NULL DEFAULT 'emissora',
  credenciamento_json JSONB,
  recredenciamento_json JSONB,
  mantenedora_json JSONB,
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cursos (
  id BIGSERIAL PRIMARY KEY,
  ies_id BIGINT NOT NULL REFERENCES ies(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  codigo_emec INTEGER,
  modalidade TEXT,
  titulo_conferido TEXT,
  outro_titulo TEXT,
  grau_conferido TEXT,
  endereco_json JSONB,
  autorizacao_json JSONB,
  reconhecimento_json JSONB,
  renovacao_reconhecimento_json JSONB,
  carga_horaria TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS diplomas_digitais (
  id BIGSERIAL PRIMARY KEY,
  aluno_id BIGINT NOT NULL REFERENCES alunos(id),
  curso_id BIGINT REFERENCES cursos(id),
  ies_emissora_id BIGINT NOT NULL REFERENCES ies(id),
  ies_registradora_id BIGINT REFERENCES ies(id),
  status TEXT NOT NULL DEFAULT 'aguardando_conclusao',
  versao_schema TEXT NOT NULL DEFAULT '1.05',
  chave_acesso TEXT,
  dados_registro_json JSONB,
  certidao_id BIGINT REFERENCES declaracoes(id),
  motivo_anulacao TEXT,
  anulado_em TIMESTAMPTZ,
  anulado_por BIGINT,
  criado_por BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_diplomas_digitais_aluno ON diplomas_digitais(aluno_id);

CREATE TABLE IF NOT EXISTS diploma_arquivos (
  id BIGSERIAL PRIMARY KEY,
  diploma_id BIGINT NOT NULL REFERENCES diplomas_digitais(id) ON DELETE CASCADE,
  tipo_arquivo TEXT NOT NULL,
  nome TEXT,
  caminho_storage TEXT,
  hash TEXT,
  versao_schema TEXT NOT NULL,
  valido_xsd INTEGER,
  erros_validacao_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_diploma_arquivos_diploma ON diploma_arquivos(diploma_id);

CREATE TABLE IF NOT EXISTS diploma_assinaturas (
  id BIGSERIAL PRIMARY KEY,
  diploma_id BIGINT NOT NULL REFERENCES diplomas_digitais(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  cpf TEXT NOT NULL,
  nome TEXT NOT NULL,
  cargo TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  cert_serial TEXT,
  assinado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auditoria_diploma (
  id BIGSERIAL PRIMARY KEY,
  diploma_id BIGINT,
  usuario_id BIGINT,
  usuario_nome TEXT,
  acao TEXT NOT NULL,
  resultado TEXT NOT NULL DEFAULT 'sucesso',
  detalhes_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auditoria_diploma ON auditoria_diploma(diploma_id);

-- ---------------------------------------------------------
-- 1.1) Migração de colunas adicionais (M3/M4 — idempotente)
-- ---------------------------------------------------------
ALTER TABLE ies ADD COLUMN IF NOT EXISTS ato_autorizacao_registro_json JSONB;
ALTER TABLE diplomas_digitais ADD COLUMN IF NOT EXISTS chave_req TEXT;
ALTER TABLE diplomas_digitais ADD COLUMN IF NOT EXISTS codigo_validacao_historico TEXT;
ALTER TABLE cursos ADD COLUMN IF NOT EXISTS carga_horaria TEXT;

-- ---------------------------------------------------------
-- 2) RLS: mesmo padrão das tabelas operacionais (só authenticated)
-- ---------------------------------------------------------

DO $$
DECLARE
  t TEXT;
  tabelas TEXT[] := ARRAY[
    'ies','cursos','diplomas_digitais','diploma_arquivos',
    'diploma_assinaturas','auditoria_diploma'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_auth_only" ON %1$I;', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_auth_only" ON %1$I
         FOR ALL TO authenticated
         USING (true) WITH CHECK (true);', t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ies, cursos, diplomas_digitais, diploma_arquivos,
     diploma_assinaturas, auditoria_diploma
  TO authenticated;

-- ---------------------------------------------------------
-- 3) Realtime (REPLICA IDENTITY FULL para o payload de DELETE)
-- ---------------------------------------------------------

DO $$
DECLARE
  t TEXT;
  tabelas TEXT[] := ARRAY[
    'ies','cursos','diplomas_digitais','diploma_arquivos',
    'diploma_assinaturas','auditoria_diploma'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'Tabela % inexistente — pulada', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I REPLICA IDENTITY FULL;', t);
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I;', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;

-- ---------------------------------------------------------
-- 4) Storage: bucket PRIVADO dos artefatos oficiais
-- ---------------------------------------------------------
-- XMLs/PDFs de diploma contêm dados pessoais (LGPD): bucket
-- privado + acesso apenas por URL assinada gerada pelo app
-- (autenticado). Estrutura: diplomas-digitais/{diploma_id}/{arquivo}

INSERT INTO storage.buckets (id, name, public)
VALUES ('diplomas-digitais', 'diplomas-digitais', false)
ON CONFLICT (id) DO NOTHING;

-- Instalações autenticadas podem gerenciar objetos do bucket
-- (upload/download/list). O público NÃO acessa: consultas usam
-- a página de validação (verificacao-web), que expõe apenas os
-- dados permitidos.
DROP POLICY IF EXISTS "diplomas_digitais_storage_auth" ON storage.objects;
CREATE POLICY "diplomas_digitais_storage_auth" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'diplomas-digitais')
  WITH CHECK (bucket_id = 'diplomas-digitais');

-- ---------------------------------------------------------
-- 5) Verificação (após Run)
-- ---------------------------------------------------------
-- Deve retornar 6:
-- SELECT count(*) FROM pg_tables
--  WHERE schemaname = 'public' AND tablename IN
--   ('ies','cursos','diplomas_digitais','diploma_arquivos',
--    'diploma_assinaturas','auditoria_diploma');
-- Deve retornar 1 (bucket privado):
-- SELECT count(*) FROM storage.buckets
--  WHERE id = 'diplomas-digitais' AND NOT public;
