-- ============================================================
-- NEXA CLASS — CORREÇÃO DE DRIFT DE SCHEMA (rode UMA vez no SQL Editor)
-- ============================================================
-- Problema: colunas existentes no SQLite do app não existiam aqui no
-- Supabase. O PUSH de qualquer tabela afetada falha com erro 42703
-- ("column ... does not exist") em TODA tentativa — a tabela para de
-- sincronizar em silêncio (o app continua funcionando localmente).
-- Afetados confirmados em 31/08/2026: alunos (a tabela principal!),
-- usuarios, declaracoes, ies, diplomas_digitais, historico_disciplinas
-- e delecoes. Alguns installs foram criados com um schema ainda mais
-- antigo (sem updated_at de historico_disciplinas/declaracoes e sem
-- senha_temporaria de usuarios) — cobertos abaixo.
--
-- Este arquivo é 100% idempotente (IF NOT EXISTS) — rodar de novo
-- não faz nada. Após rodar, o sync de 15s do app empurra os dados
-- locais acumulados automaticamente (nada a fazer no app).
--
-- Verificação ao final: todas as queries devem retornar true.
-- ============================================================

-- usuarios
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS reset_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_temporaria INTEGER NOT NULL DEFAULT 0;

-- alunos (tabela central — sem estas colunas os ALUNOS nunca sobem p/ nuvem)
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS origem TEXT DEFAULT 'sistema';
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS rg_uf TEXT;
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS nome_social TEXT;
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS naturalidade_codigo_ibge TEXT;
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS naturalidade_uf TEXT;
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS naturalidade_estrangeira TEXT;
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS mae_nome TEXT;
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS mae_sexo TEXT;
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS pai_nome TEXT;
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS pai_sexo TEXT;
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS enade_json TEXT;

-- declaracoes
ALTER TABLE declaracoes ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'generico';
ALTER TABLE declaracoes ADD COLUMN IF NOT EXISTS diploma_id BIGINT;
ALTER TABLE declaracoes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- historico_disciplinas (installs criados com schema antigo não têm a coluna)
ALTER TABLE historico_disciplinas ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ies (Diploma Digital: sem esta coluna o cadastro institucional nunca sobe)
ALTER TABLE ies ADD COLUMN IF NOT EXISTS renovacao_recredenciamento_json JSONB;

-- cursos (Diploma Digital: colunas do cadastro de cursos adicionadas depois)
ALTER TABLE cursos ADD COLUMN IF NOT EXISTS habilitacao_json JSONB;
ALTER TABLE cursos ADD COLUMN IF NOT EXISTS reconhecimento_emec_json JSONB;

-- diplomas_digitais
ALTER TABLE diplomas_digitais ADD COLUMN IF NOT EXISTS data_expedicao TEXT;

-- delecoes (paridade com o schema local)
ALTER TABLE delecoes ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'local';

-- ---------------------------------------------------------
-- Recarrega o cache de schema do PostgREST. Após ALTERs feitos pelo
-- SQL Editor, instâncias do PostgREST podem continuar servindo o
-- schema ANTIGO por um tempo — o push do app falha com PGRST204
-- ("Could not find the column ... in the schema cache") mesmo com a
-- coluna já existindo. O NOTIFY força o reload em todas.
-- ---------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Verificação (cada linha deve retornar true)
-- ---------------------------------------------------------
SELECT to_regclass('public.alunos') IS NOT NULL AS tabela_alunos_ok;
SELECT COUNT(*) = 21 AS drift_corrigido
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (
      (table_name = 'usuarios'   AND column_name IN ('reset_attempts','senha_temporaria')) OR
      (table_name = 'alunos'     AND column_name IN ('origem','rg_uf','nome_social','naturalidade_codigo_ibge','naturalidade_uf','naturalidade_estrangeira','mae_nome','mae_sexo','pai_nome','pai_sexo','enade_json')) OR
      (table_name = 'declaracoes' AND column_name IN ('tipo','diploma_id','updated_at')) OR
      (table_name = 'historico_disciplinas' AND column_name = 'updated_at') OR
      (table_name = 'ies'        AND column_name IN ('renovacao_recredenciamento_json')) OR
      (table_name = 'cursos'     AND column_name IN ('habilitacao_json','reconhecimento_emec_json')) OR
      (table_name = 'diplomas_digitais' AND column_name = 'data_expedicao')
    );
