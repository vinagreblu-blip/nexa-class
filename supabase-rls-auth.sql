-- ============================================================
-- NEXA CLASS — Migration RLS Auth: exigir Supabase Auth por instalação
-- ============================================================
-- Aplique no SQL Editor do Supabase DEPOIS de rodar:
--   1. supabase-schema.sql
--   2. supabase-migration-rls.sql
--
-- Objetivo: fechar a brecha onde a anon key (que é pública e está
-- embutida no .exe) sozinha permitia ler todos os dados dos alunos.
-- A partir de agora, TODA tabela operacional exige a role
-- `authenticated` — ou seja, um JWT válido obtido via Supabase Auth.
-- Cada instalação do desktop cria sua própria identidade Supabase Auth
-- (random email/senha salvos em userData) e usa o JWT para acessar os
-- dados. A anon key sozinha passa a ser inútil.
--
-- PRÉ-REQUISITO no Dashboard do Supabase:
--   Authentication → Providers → Email → desmarcar "Confirm email"
--   (as identidades são de máquina, com e-mails fake @nexa-class.local;
--    confirmação por email não faz sentido e bloquearia o fluxo automático)
-- ============================================================

-- ---------------------------------------------------------
-- 1) Tabelas operacionais: dropar allow_all e exigir authenticated
-- ---------------------------------------------------------
-- RLS no Supabase: se não há policy para a role, o acesso é NEGADO.
-- Ao criar policies só para `authenticated`, a role `anon` fica de fora.

DO $$
DECLARE
  t TEXT;
  tabelas TEXT[] := ARRAY[
    'usuarios','alunos','docentes','disciplinas','historico_disciplinas',
    'declaracoes','assinaturas','diplomas','atas_colacao','cursos_livres',
    'curso_livre_alunos','aluno_documentos'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('DROP POLICY IF EXISTS "allow_all" ON %I;', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_auth_only" ON %1$I
         FOR ALL TO authenticated
         USING (true) WITH CHECK (true);', t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------
-- 2) Tabela instalacoes: registro de cada máquina + revogação soft
-- ---------------------------------------------------------
-- Cada instalação do desktop cria/atualiza sua linha aqui a cada sync.
-- O admin pode setar revoked=1 pelo Dashboard do app para sinalizar
-- "pare de sincronizar" (app checa e mostra banner).
-- Revogação HARD (bloquear signIn) = deletar o usuário em
-- Authentication → Users do Dashboard do Supabase.

CREATE TABLE IF NOT EXISTS instalacoes (
  machine_id TEXT PRIMARY KEY,
  hostname TEXT,
  app_versao TEXT,
  identity_email TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ
);

ALTER TABLE instalacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "instalacoes_auth" ON instalacoes;
-- Qualquer instalação autenticada pode ler (lista de máquinas no Dashboard)
-- e atualizar sua própria linha. Revogação é um UPDATE de revoked=1.
CREATE POLICY "instalacoes_auth" ON instalacoes
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------
-- 3) Concede privilégios de linha à role authenticated
-- ---------------------------------------------------------
-- (PostgREST exige GRANT além de RLS para a role operar.)
GRANT SELECT, INSERT, UPDATE, DELETE
  ON usuarios, alunos, docentes, disciplinas, historico_disciplinas,
     declaracoes, assinaturas, diplomas, atas_colacao, cursos_livres,
     curso_livre_alunos, aluno_documentos, instalacoes
  TO authenticated;

-- ---------------------------------------------------------
-- 4) Verificação rápida (rode após aplicar)
-- ---------------------------------------------------------
-- Deve retornar 1 se aplicou corretamente:
-- SELECT count(*) FROM pg_policies WHERE policyname LIKE '%_auth_only';
