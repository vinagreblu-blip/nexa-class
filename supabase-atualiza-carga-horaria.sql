-- ============================================================
-- NEXA CLASS — CARGAS HORÁRIAS COMPLETAS DOS CURSOS (rode UMA vez no SQL Editor)
-- ============================================================
-- 21 cursos com a carga horária total oficial (informada pela instituição
-- em 01/09/2026). updated_at = NOW() garante que o sync entregue a todas
-- as máquinas automaticamente (nada a fazer no app).
--
-- Idempotente: rodar de novo só re-aplica os mesmos valores.
-- Pendências conhecidas (sem CH E sem autorização — documentadas):
--   id 7  — Engenharia de Telecomunicações (FACIIP)
--   id 21 — Administração (2 de Julho)
-- ============================================================

UPDATE cursos AS c
SET carga_horaria = v.ch,
    updated_at = NOW()
FROM (VALUES
  -- FACIIP (IES 1)
  (1,  '3000'),  -- Administração
  (3,  '3000'),  -- Administração Hospitalar
  (4,  '3000'),  -- Ciências Contábeis
  (5,  '2700'),  -- Comunicação Social (Relações Públicas)
  (6,  '3920'),  -- Engenharia de Produção Mecânica
  (8,  '3140'),  -- Jornalismo
  (9,  '3200'),  -- Pedagogia
  (10, '3000'),  -- Turismo e Hotelaria
  -- FACULDADE HÉLIO ROCHA (IES 2)
  (11, '3000'),  -- Administração
  (12, '2880'),  -- Comunicação Social (Publicidade e Propaganda)
  (13, '3690'),  -- Engenharia Civil
  (14, '3690'),  -- Engenharia de Produção
  (15, '3690'),  -- Engenharia Elétrica
  (16, '4740'),  -- Fisioterapia
  (17, '3690'),  -- Serviço Social
  (18, '3000'),  -- Sistema de Informação
  (19, '3180'),  -- Turismo
  -- FATECE (IES 3)
  (22, '3000'),  -- Administração
  (23, '3300'),  -- Pedagogia
  (24, '3000'),  -- Teologia
  -- FACULDADE 2 DE JULHO (IES 4)
  (20, '3700')   -- Direito
) AS v(id, ch)
WHERE c.id = v.id;

-- ---------------------------------------------------------
-- Verificação
-- ---------------------------------------------------------
-- Deve retornar 21:
SELECT COUNT(*) AS cursos_com_ch FROM cursos WHERE ativo = 1 AND carga_horaria IS NOT NULL;
-- Deve retornar exatamente 2 linhas (as pendências conhecidas id 7 e 21):
SELECT id, nome FROM cursos WHERE ativo = 1 AND carga_horaria IS NULL;
