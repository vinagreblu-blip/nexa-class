-- ============================================================
-- NEXA CLASS — Migration: compartilhamento de PDFs assinados
-- ============================================================
-- Aplique no SQL Editor do Supabase (pode rodar a qualquer momento,
-- antes ou depois do supabase-realtime.sql; é idempotente).
--
-- Objetivo: o PDF assinado digitalmente (A3) existe apenas no disco da
-- máquina que tem o token. Com esta tabela, toda emissão assinada
-- (declaração, diploma, histórico, certificado, ata) também envia uma
-- cópia para a nuvem — as outras máquinas baixam automaticamente ao
-- clicar em "Baixar", sem precisar do token.
--
-- Segurança: mesma política das demais tabelas — exige a role
-- `authenticated` (JWT por instalação). A tabela `arquivos` antiga segue
-- BLOQUEADA (guardava chaves privadas); esta é nova e específica de PDFs.
--
-- Retenção: PDFs são limpos manualmente pelo admin se necessário; o plano
-- Free tem 500MB (~2.500 PDFs assinados de 200KB; documentos assinados
-- tipicamente têm 100-400KB).
-- ============================================================

CREATE TABLE IF NOT EXISTS arquivos_pdf (
  id BIGSERIAL PRIMARY KEY,
  tabela TEXT NOT NULL CHECK (tabela IN ('declaracoes','diplomas','historicos','certificados','atas_colacao')),
  registro_id BIGINT NOT NULL,
  nome_arquivo TEXT,
  dados TEXT NOT NULL,             -- PDF em base64
  bytes BIGINT NOT NULL DEFAULT 0,
  host_origem TEXT,                -- hostname que assinou (traceabilidade)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tabela, registro_id)
);

ALTER TABLE arquivos_pdf ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "arquivos_pdf_auth" ON arquivos_pdf;
CREATE POLICY "arquivos_pdf_auth" ON arquivos_pdf
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON arquivos_pdf TO authenticated;

-- ---------------------------------------------------------
-- Verificação rápida (rode após aplicar)
-- ---------------------------------------------------------
-- Deve retornar 1:
-- SELECT count(*) FROM pg_tables
--  WHERE tablename = 'arquivos_pdf' AND rowsecurity;
