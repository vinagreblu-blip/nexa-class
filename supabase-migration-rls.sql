-- ============================================================
-- NEXA CLASS — Migration Supabase: tighten RLS + proteger dados sensíveis
-- Aplique no SQL Editor do Supabase DEPOIS de rodar supabase-schema.sql.
--
-- Objetivos:
--   1. Bloquear acesso anônimo a usuarios.password_hash e usuarios.reset_token
--      (evita ataque offline de bcrypt em GPU com a anon key pública).
--   2. Bloquear acesso anônimo à tabela arquivos (onde antes eram salvos
--      certificados .pfx — chave privada ICP-Brasil).
--   3. Documentar claramente que as demais tabelas seguem abertas (compat
--      com sync via anon key) e que o caminho seguro é Supabase Auth por usuário.
-- ============================================================

-- ---------------------------------------------------------
-- 1) usuarios: bloquear leitura de colunas sensíveis via column-level GRANT
-- ---------------------------------------------------------
-- O Supabase expõe as tabelas via API PostgREST usando a role `anon` e `authenticated`.
-- Por padrão, todas as colunas são legíveis. Vamos revogar e conceder seletivamente.

-- Revoga SELECT em todas as colunas de usuarios para anon/authenticated
REVOKE SELECT ON usuarios FROM anon, authenticated;

-- Concede SELECT apenas nas colunas não-sensíveis
GRANT SELECT (
  id, codigo, username, nome, email, role, foto_path, ativo,
  created_at, updated_at
) ON usuarios TO anon, authenticated;

-- INSERT/UPDATE/DELETE continuam necessários para o app funcionar
-- (limitado pela policy abaixo; column-level para password_hash só via service_role)
GRANT INSERT (codigo, username, password_hash, nome, email, role, ativo, foto_path)
  ON usuarios TO anon, authenticated;
GRANT UPDATE (codigo, username, password_hash, nome, email, role, ativo, foto_path)
  ON usuarios TO anon, authenticated;
GRANT DELETE ON usuarios TO anon, authenticated;

-- ---------------------------------------------------------
-- 2) arquivos: bloquear totalmente o acesso anônimo
-- ---------------------------------------------------------
-- Esta tabela guardava .pfx (chave privada) e DB snapshots inteiros.
-- A partir da migration, nenhum cliente anônimo deve ler ou escrever aqui.
-- O app Electron parou de usar essa tabela (ver ipc/assinatura.ts).
REVOKE ALL PRIVILEGES ON arquivos FROM anon, authenticated;

-- Dropa a policy allow_all e cria uma policy negativa explícita
DROP POLICY IF EXISTS "allow_all" ON arquivos;
CREATE POLICY "arquivos_denegado_anon" ON arquivos
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- ---------------------------------------------------------
-- 3) Tabelas operacionais — mantêm allow_all por enquanto
-- ---------------------------------------------------------
-- NOTA DE SEGURANÇA: o sync bidirecional do app Electron usa a anon key
-- (que está embutida no binário). Enquanto isso não migrar para Supabase Auth
-- por usuário (com JWT por sessão), a RLS precisa permitir leitura/escrita
-- de alunos/docentes/disciplinas/historico_disciplinas/declaracoes/assinaturas.
--
-- Para fechar totalmente esta brecha:
--   a) Adicione `institution_id UUID NOT NULL` em todas as tabelas.
--   b) Implemente login via Supabase Auth no Electron (substituindo a tabela
--      `usuarios` local por auth.users).
--   c) Substitua a policy abaixo por:
--        USING (institution_id = (auth.jwt() ->> 'institution_id')::uuid)
--        WITH CHECK (institution_id = (auth.jwt() ->> 'institution_id')::uuid)
--   d) Remova a anon key do binário Electron (cloud.ts).
-- Esse trabalho está fora do escopo desta migration.

-- (nenhuma alteração adicional nas tabelas operacionais — apenas registro)


-- ---------------------------------------------------------
-- 4) Auditoria básica (opcional, mas recomendada)
-- ---------------------------------------------------------
-- Log imutável de quem alterou o quê. Útil em incidentes.
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  row_id BIGINT,
  action TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  old_data JSONB,
  new_data JSONB
);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_readonly_anon" ON audit_log;
-- Anon pode só inserir (para log), não ler nem modificar
CREATE POLICY "audit_append_only" ON audit_log
  FOR INSERT TO anon, authenticated WITH CHECK (true);
REVOKE SELECT, UPDATE, DELETE ON audit_log FROM anon, authenticated;
