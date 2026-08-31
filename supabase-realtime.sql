-- ============================================================
-- NEXA CLASS — Migration Realtime: sincronização instantânea
-- ============================================================
-- Aplique no SQL Editor do Supabase DEPOIS de rodar:
--   1. supabase-schema.sql
--   2. supabase-migration-rls.sql
--   3. supabase-rls-auth.sql
--
-- Objetivo: habilitar o Supabase Realtime (postgres_changes) nas
-- tabelas operacionais para que toda máquina conectada receba
-- INSERT/UPDATE/DELETE instantaneamente via WebSocket, sem
-- aguardar o ciclo de sync de 15s.
--
-- O que este script faz:
--   1. REPLICA IDENTITY FULL — o payload do DELETE inclui a linha
--      inteira (necessário para o app saber QUAL id foi excluído).
--   2. Adiciona as tabelas à publication `supabase_realtime`.
--
-- É idempotente: pode rodar quantas vezes quiser.
-- ============================================================

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
    -- Ignora tabelas que não existam no projeto (nenhuma alteração necessária).
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'Tabela % inexistente — pulada (realtime não habilitado para ela)', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I REPLICA IDENTITY FULL;', t);
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I;', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------
-- Tombstones de exclusão (propagação de DELETE entre máquinas)
-- ---------------------------------------------------------
-- Quando uma máquina exclui um registro, o app grava um tombstone local
-- (trigger SQLite) e o envia para cá. As outras máquinas aplicam o DELETE
-- no pull, e o Realtime entrega o DELETE ao vivo para quem está conectado.
-- A limpeza (`limpar_delecoes_antigas`) remove tombstones com mais de
-- 90 dias — máquinas offline por mais que isso podem perder exclusões.

CREATE TABLE IF NOT EXISTS delecoes (
  tabela TEXT NOT NULL,
  id BIGINT NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  origem TEXT NOT NULL DEFAULT 'local',
  PRIMARY KEY (tabela, id)
);

-- Coluna adicionada depois da criação original (idempotente).
ALTER TABLE delecoes ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'local';

ALTER TABLE delecoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "delecoes_auth" ON delecoes;
CREATE POLICY "delecoes_auth" ON delecoes
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON delecoes TO authenticated;

-- Limpeza automática de tombstones antigos (roda a cada INSERT na tabela).
-- Função de TRIGGER precisa declarar RETURNS trigger (não void) — senão o
-- Postgres rejeita com erro 42P17 "must return type trigger".
-- DROP FUNCTION é necessário porque CREATE OR REPLACE não pode mudar o
-- tipo de retorno de uma função já criada (ex.: correção de um script antigo).
-- Security definer + fixed search_path: padrão exigido pelo Supabase.
DROP TRIGGER IF EXISTS trg_limpar_delecoes ON delecoes;
DROP FUNCTION IF EXISTS limpar_delecoes_antigas();

CREATE OR REPLACE FUNCTION limpar_delecoes_antigas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM delecoes WHERE deleted_at < NOW() - INTERVAL '90 days';
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_limpar_delecoes
  AFTER INSERT ON delecoes
  FOR EACH STATEMENT
  EXECUTE FUNCTION limpar_delecoes_antigas();

-- ---------------------------------------------------------
-- Verificação rápida (rode após aplicar)
-- ---------------------------------------------------------
-- Deve retornar 12:
-- SELECT count(*) FROM pg_publication_tables
--  WHERE pubname = 'supabase_realtime';
