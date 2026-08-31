-- ============================================================
-- NEXA CLASS — PRÉ-CADASTRO INSTITUCIONAL COMPLETO (rode UMA vez no SQL Editor)
-- ============================================================
-- 4 IES + 24 cursos de graduação com dados oficiais (e-MEC, CNPJ,
-- endereços, credenciamentos e atos de autorização/reconhecimento).
-- Idempotente: pode rodar de novo sem duplicar (upsert por id).
-- Após rodar, TODAS as máquinas recebem tudo via sync em ~15s —
-- não é preciso cadastrar nada pela tela do app.
--
-- AVISOS (não bloqueiam):
--  * IBGE de Ipirá usado: 2913605 — confira em codigos.ibge.gov.br
--  * Cursos marcados com "PORTARIA DUPLA": a portaria de reconhecimento
--    informada é a mesma da autorização (usada para destravar) — ao
--    obter a portaria de reconhecimento real, edite o curso na tela
--    Diplomas Digitais → Cadastro Institucional.
-- ============================================================

-- ---------------------------------------------------------
-- 1) IES (4)
-- ---------------------------------------------------------
INSERT INTO ies (id, nome, codigo_emec, cnpj, logradouro, numero, complemento, bairro,
                 codigo_municipio, nome_municipio, uf, cep, papel,
                 credenciamento_json, recredenciamento_json, ativo, updated_at)
VALUES
-- FACIIP (corrige o cadastro existente: typo no nome, logradouro, complemento)
(1, 'FACIIP - FACULDADES INTEGRADAS IPITANGA', 3609, '37506747000126',
 'Avenida Luiz Tarquínio Pontes', '0', NULL, 'Pitangueiras',
 '2919207', 'Lauro de Freitas', 'BA', '42701450', 'emissora',
 '{"tipo":"Portaria","numero":"687","data":"1998-07-08"}',
 '{"tipo":"Portaria","numero":"2547","data":"2003-09-15"}',
 1, NOW()),
-- FACULDADE HÉLIO ROCHA
(2, 'FACULDADE HÉLIO ROCHA', 1639, '03466601000182',
 'Avenida Leovigildo Filgueiras', '81 a 85', NULL, 'Garcia',
 '2927408', 'Salvador', 'BA', '40100000', 'emissora',
 '{"tipo":"Portaria","numero":"338","data":"2024-07-18"}',
 NULL,
 1, NOW()),
-- FATECE
(3, 'Faculdade Tecnologia de Ciências e Educação - FATECE', 2163, '30159458000159',
 'Rua Manoel Oliveira e Silva', '127', 'Campus Universitário', 'Campus Universitário',
 '2913605', 'Ipirá', 'BA', '44600000', 'emissora',
 '{"tipo":"Portaria","numero":"3527","data":"2004-10-29"}',
 NULL,
 1, NOW()),
-- FACULDADE 2 DE JULHO
(4, 'Faculdade 2 de Julho', 1411, '44379083000147',
 'Avenida Leovigildo Filgueiras', '81 a 85', NULL, 'Garcia',
 '2927408', 'Salvador', 'BA', '40100000', 'emissora',
 '{"tipo":"Portaria","numero":"1411","data":"2025-11-28"}',
 NULL,
 1, NOW())
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, codigo_emec = EXCLUDED.codigo_emec, cnpj = EXCLUDED.cnpj,
  logradouro = EXCLUDED.logradouro, numero = EXCLUDED.numero,
  complemento = EXCLUDED.complemento, bairro = EXCLUDED.bairro,
  codigo_municipio = EXCLUDED.codigo_municipio, nome_municipio = EXCLUDED.nome_municipio,
  uf = EXCLUDED.uf, cep = EXCLUDED.cep, papel = EXCLUDED.papel,
  credenciamento_json = EXCLUDED.credenciamento_json,
  recredenciamento_json = EXCLUDED.recredenciamento_json,
  ativo = EXCLUDED.ativo, updated_at = NOW();

-- ---------------------------------------------------------
-- 2) CURSOS — FACIIP (IES 1)
-- ---------------------------------------------------------
INSERT INTO cursos (id, ies_id, nome, codigo_emec, modalidade, titulo_conferido,
                    grau_conferido, autorizacao_json, reconhecimento_json,
                    renovacao_reconhecimento_json, ativo, updated_at)
VALUES
-- Administração: corrige o cadastro existente (datas + renovação)
(1, 1, 'Administração', 20807, 'Presencial', 'Bacharel', 'Bacharelado',
 '{"tipo":"Portaria","numero":"744","data":"1999-05-06"}',
 '{"tipo":"Portaria","numero":"2650","data":"2005-07-27"}',
 '{"tipo":"Portaria","numero":"931","data":"2017-08-24"}',
 1, NOW()),
(3, 1, 'Administração Hospitalar', 18164, 'Presencial', 'Bacharel', 'Bacharelado',
 '{"tipo":"Portaria","numero":"744","data":"1999-05-06"}',
 '{"tipo":"Portaria","numero":"572","data":"2004-03-12"}',
 NULL,
 1, NOW()),
(4, 1, 'Ciências Contábeis', 20605, 'Presencial', 'Bacharel', 'Bacharelado',
 '{"tipo":"Portaria","numero":"111","data":"2012-06-26"}',
 '{"tipo":"Portaria","numero":"705","data":"2013-12-18"}',
 NULL,
 1, NOW()),
(5, 1, 'Comunicação Social (Relações Públicas)', 21307, 'Presencial', 'Bacharel', 'Bacharelado',
 '{"tipo":"Portaria","numero":"107","data":"2000-02-10"}',
 '{"tipo":"Portaria","numero":"311","data":"2006-01-30"}',
 NULL,
 1, NOW()),
(6, 1, 'Engenharia de Produção Mecânica', 19737, 'Presencial', 'Bacharel', 'Bacharelado',
 '{"tipo":"Portaria","numero":"79","data":"1999-01-14"}',
 '{"tipo":"Portaria","numero":"278","data":"2015-04-01"}',
 NULL,
 1, NOW()),
-- Eng. Telecomunicações: autorização NÃO informada — pendência ao usar
(7, 1, 'Engenharia de Telecomunicações', 50974, 'Presencial', 'Bacharel', 'Bacharelado',
 NULL,
 '{"tipo":"Portaria","numero":"48","data":"2010-01-13"}',
 NULL,
 1, NOW()),
(8, 1, 'Jornalismo', 20692, 'Presencial', 'Bacharel', 'Bacharelado',
 '{"tipo":"Portaria","numero":"1809","data":"1999-12-17"}',
 '{"tipo":"Portaria","numero":"584","data":"2020-12-09"}',
 NULL,
 1, NOW()),
(9, 1, 'Pedagogia', 107330, 'Presencial', 'Licenciado', 'Licenciatura',
 '{"tipo":"Portaria","numero":"1457","data":"1998-12-23"}',
 '{"tipo":"Portaria","numero":"1094","data":"2015-12-24"}',
 NULL,
 1, NOW()),
(10, 1, 'Turismo e Hotelaria', 18343, 'Presencial', 'Bacharel', 'Bacharelado',
 '{"tipo":"Portaria","numero":"1106","data":"1998-09-28"}',
 '{"tipo":"Portaria","numero":"1099","data":"2004-04-29"}',
 NULL,
 1, NOW())
ON CONFLICT (id) DO UPDATE SET
  ies_id = EXCLUDED.ies_id, nome = EXCLUDED.nome, codigo_emec = EXCLUDED.codigo_emec,
  modalidade = EXCLUDED.modalidade, titulo_conferido = EXCLUDED.titulo_conferido,
  grau_conferido = EXCLUDED.grau_conferido, autorizacao_json = EXCLUDED.autorizacao_json,
  reconhecimento_json = EXCLUDED.reconhecimento_json,
  renovacao_reconhecimento_json = EXCLUDED.renovacao_reconhecimento_json,
  ativo = EXCLUDED.ativo, updated_at = NOW();

-- ---------------------------------------------------------
-- 3) CURSOS — FACULDADE HÉLIO ROCHA (IES 2)
-- ---------------------------------------------------------
INSERT INTO cursos (id, ies_id, nome, codigo_emec, modalidade, titulo_conferido,
                    grau_conferido, autorizacao_json, reconhecimento_json,
                    renovacao_reconhecimento_json, ativo, updated_at)
VALUES
(11, 2, 'Administração', 106513, 'Presencial', 'Bacharel', 'Bacharelado',
 '{"tipo":"Portaria","numero":"211","data":"2001-02-08"}',
 '{"tipo":"Portaria","numero":"490","data":"2006-02-09"}',
 '{"tipo":"Portaria","numero":"706","data":"2016-11-10"}',
 1, NOW()),
(12, 2, 'Comunicação Social (Publicidade e Propaganda)', 46290, 'Presencial', 'Bacharel', 'Bacharelado',
 '{"tipo":"Portaria","numero":"602","data":"2001-03-28"}',
 '{"tipo":"Portaria","numero":"524","data":"2013-10-15"}',
 '{"tipo":"Portaria","numero":"930","data":"2017-08-24"}',
 1, NOW()),
-- PORTARIA DUPLA (reconhecimento = autorização; obter a real depois)
(13, 2, 'Engenharia Civil', 1169327, 'Presencial', 'Bacharel', 'Bacharelado',
 '{"tipo":"Portaria","numero":"406","data":"2013-08-30"}',
 '{"tipo":"Portaria","numero":"406","data":"2013-08-30"}',
 NULL,
 1, NOW()),
-- PORTARIA DUPLA
(14, 2, 'Engenharia de Produção', 1177416, 'Presencial', 'Bacharel', 'Bacharelado',
 '{"tipo":"Portaria","numero":"120","data":"2013-03-15"}',
 '{"tipo":"Portaria","numero":"120","data":"2013-03-15"}',
 NULL,
 1, NOW()),
-- PORTARIA DUPLA
(15, 2, 'Engenharia Elétrica', 1169330, 'Presencial', 'Bacharel', 'Bacharelado',
 '{"tipo":"Portaria","numero":"326","data":"2013-07-24"}',
 '{"tipo":"Portaria","numero":"326","data":"2013-07-24"}',
 NULL,
 1, NOW()),
-- PORTARIA DUPLA
(16, 2, 'Fisioterapia', 1386456, 'Presencial', 'Bacharel', 'Bacharelado',
 '{"tipo":"Portaria","numero":"172","data":"2019-04-09"}',
 '{"tipo":"Portaria","numero":"172","data":"2019-04-09"}',
 NULL,
 1, NOW()),
(17, 2, 'Serviço Social', 1165489, 'Presencial', 'Bacharel', 'Bacharelado',
 '{"tipo":"Portaria","numero":"280","data":"2012-12-19"}',
 '{"tipo":"Portaria","numero":"745","data":"2017-07-14"}',
 NULL,
 1, NOW()),
(18, 2, 'Sistema de Informação', 46287, 'Presencial', 'Bacharel', 'Bacharelado',
 '{"tipo":"Portaria","numero":"348","data":"2001-02-23"}',
 '{"tipo":"Portaria","numero":"490","data":"2006-02-09"}',
 NULL,
 1, NOW()),
(19, 2, 'Turismo', 46282, 'Presencial', 'Bacharel', 'Bacharelado',
 '{"tipo":"Portaria","numero":"210","data":"2001-02-08"}',
 '{"tipo":"Portaria","numero":"490","data":"2006-02-09"}',
 NULL,
 1, NOW())
ON CONFLICT (id) DO UPDATE SET
  ies_id = EXCLUDED.ies_id, nome = EXCLUDED.nome, codigo_emec = EXCLUDED.codigo_emec,
  modalidade = EXCLUDED.modalidade, titulo_conferido = EXCLUDED.titulo_conferido,
  grau_conferido = EXCLUDED.grau_conferido, autorizacao_json = EXCLUDED.autorizacao_json,
  reconhecimento_json = EXCLUDED.reconhecimento_json,
  renovacao_reconhecimento_json = EXCLUDED.renovacao_reconhecimento_json,
  ativo = EXCLUDED.ativo, updated_at = NOW();

-- ---------------------------------------------------------
-- 4) CURSOS — 2 DE JULHO (IES 4) e FATECE (IES 3)
-- ---------------------------------------------------------
INSERT INTO cursos (id, ies_id, nome, codigo_emec, modalidade, titulo_conferido,
                    grau_conferido, autorizacao_json, reconhecimento_json,
                    renovacao_reconhecimento_json, ativo, updated_at)
VALUES
(20, 4, 'Direito', 55596, 'Presencial', 'Bacharel', 'Bacharelado',
 '{"tipo":"Portaria","numero":"2032","data":"2002-07-15"}',
 '{"tipo":"Portaria","numero":"207","data":"2020-06-25"}',
 NULL,
 1, NOW()),
-- Administração: autorização NÃO informada — pendência ao usar
(21, 4, 'Administração', 20632, 'Presencial', 'Bacharel', 'Bacharelado',
 NULL,
 '{"tipo":"Portaria","numero":"268","data":"2017-04-03"}',
 NULL,
 1, NOW()),
-- PORTARIA DUPLA
(22, 3, 'Administração', 1261187, 'Presencial', 'Bacharel', 'Bacharelado',
 '{"tipo":"Portaria","numero":"254","data":"2015-03-17"}',
 '{"tipo":"Portaria","numero":"254","data":"2015-03-17"}',
 NULL,
 1, NOW()),
(23, 3, 'Pedagogia', 105812, 'Presencial', 'Licenciado', 'Licenciatura',
 '{"tipo":"Portaria","numero":"3530","data":"2004-10-29"}',
 '{"tipo":"Portaria","numero":"916","data":"2018-12-27"}',
 NULL,
 1, NOW()),
-- PORTARIA DUPLA
(24, 3, 'Teologia', 1180229, 'Presencial', 'Bacharel', 'Bacharelado',
 '{"tipo":"Portaria","numero":"326","data":"2013-07-24"}',
 '{"tipo":"Portaria","numero":"326","data":"2013-07-24"}',
 NULL,
 1, NOW())
ON CONFLICT (id) DO UPDATE SET
  ies_id = EXCLUDED.ies_id, nome = EXCLUDED.nome, codigo_emec = EXCLUDED.codigo_emec,
  modalidade = EXCLUDED.modalidade, titulo_conferido = EXCLUDED.titulo_conferido,
  grau_conferido = EXCLUDED.grau_conferido, autorizacao_json = EXCLUDED.autorizacao_json,
  reconhecimento_json = EXCLUDED.reconhecimento_json,
  renovacao_reconhecimento_json = EXCLUDED.renovacao_reconhecimento_json,
  ativo = EXCLUDED.ativo, updated_at = NOW();

-- ---------------------------------------------------------
-- 5) Desativa o curso ADMINISTRAÇÃO duplicado da FACIIP (id 2)
-- ---------------------------------------------------------
UPDATE cursos SET ativo = 0, updated_at = NOW() WHERE id = 2;

-- ---------------------------------------------------------
-- 6) Verificação
-- ---------------------------------------------------------
-- Deve retornar 4:
SELECT COUNT(*) AS ies_ativas FROM ies WHERE ativo = 1;
-- Deve retornar 23:
SELECT COUNT(*) AS cursos_ativos FROM cursos WHERE ativo = 1;
-- Deve retornar exatamente 2 linhas (as autorizações pendentes conhecidas):
--   id 7  — Engenharia de Telecomunicações (FACIIP, sem autorização informada)
--   id 21 — Administração (2 de Julho, sem autorização informada)
SELECT id, nome FROM cursos
 WHERE ativo = 1 AND (codigo_emec IS NULL
   OR autorizacao_json IS NULL OR reconhecimento_json IS NULL);
