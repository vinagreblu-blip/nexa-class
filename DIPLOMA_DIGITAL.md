# DIPLOMA DIGITAL MEC — Documentação Técnica do Módulo

> Estado: **M1 concluído** (fundação), **M2 concluído** (UI + dados
> institucionais + sync). M3 (geração/validação XML) em desenvolvimento na
> branch `feat/diploma-digital-mec`.

Este documento descreve a arquitetura do módulo de **Diploma Digital de
graduação** conforme a especificação oficial do MEC (Sesu), que **substitui o
fluxo de diploma em papel** e é **obrigatória para o Sistema Federal de Ensino
desde 01/07/2025**.

- Página oficial: https://www.gov.br/mec/pt-br/diploma-digital
- Pacote XSD v1.05: https://www.gov.br/mec/pt-br/diploma-digital/dados
- Validador oficial: https://verificadordiplomadigital.mec.gov.br/diploma

## 1. Princípio fundamental: NÃO SIMULAR

Nenhuma etapa oficial é simulada. As etapas que dependem de infraestrutura
externa (assinatura XAdES, registro pela IES Registradora, código de validação
oficial, carimbo do tempo) permanecem em status **"AGUARDANDO …"** /
**"CONFIGURAÇÃO NECESSÁRIA"** com instruções exatas do que falta, por que,
como e onde configurar. Um XML que passou no XSD **não** tem validade
jurídica por si — a conformidade estrutural é uma etapa do processo.

## 2. Separação: Certidão de Conclusão × Diploma Digital

| | Certidão de Conclusão (existente) | Diploma Digital (novo) |
|---|---|---|
| Natureza | Documento interno com QR/código próprio | Documento oficial MEC |
| Estrutura | `declaracoes` (tipo `generico`), PDF pdfkit | `diplomas_digitais` + XSD v1.05 |
| XML | não tem | obrigatório, validado contra XSD |
| Assinatura | PAdES (A1/A3) no PDF | XAdES no XML (M4) |
| Registro | não se aplica | IES Registradora (M4) |

A Certidão **continua existindo** com PDF/QR/código/página pública. Quando um
diploma digital é aberto para o aluno, a certidão ganha o vínculo
(`certidao_id`) e o botão "Ver processo do Diploma".

## 3. Artefatos oficiais (quando cada um é usado)

| Artefato | XSD | Quando |
|---|---|---|
| Diploma Digital | `DiplomaDigital_v1.05.xsd` | Documento final; contém DadosDiploma (emissora) + DadosRegistro (registradora) |
| Documentação Acadêmica | `DocumentacaoAcademicaRegistroDiplomaDigital_v1.05.xsd` | Enviada **à IES Registradora** para obter o registro (Requerimento de Registro) |
| Histórico Escolar Digital | `HistoricoEscolarDigital_v1.05.xsd` | Documento próprio (parcial/final/2ª via nato-físico); acompanha a DA |
| Currículo Escolar Digital | `CurriculoEscolarDigital_v1.05.xsd` | Matriz curricular do curso, referenciada pelo histórico |
| Lista de Diplomas Anulados | `ListaDiplomasAnulados_v1.05.xsd` | Relatório de diplomas com registro anulado pela registradora (M5) |
| Arquivo de Fiscalização | `ArquivoFiscalizacao_v1.05.xsd` | Exportação solicitada pelo MEC em fiscalização (M5) |

## 4. Fluxo do processo (status)

```
aguardando_conclusao → apto → em_preparacao → xml_gerado → (xml_invalido ↺)
  → aguardando_assinatura (M4) → assinado (M4) → aguardando_registro (M4)
  → registrado (M4) → publicado (M4/M5)
  ↘ anulado / cancelado (preservando histórico — nunca DELETE físico)
```

- **apto** só quando `verificarPendencias()` não retorna bloqueios
  (CPF, RG+UF, naturalidade IBGE, dados do curso/IES, colação…).
- Geração de XML valida contra XSD **antes** de prosseguir; XML inválido
  registra os erros campo-a-campo e o status volta a `xml_invalido`.

## 5. Arquitetura técnica

- **Schemas**: `schemas/v1.05/` (13 XSDs oficiais verbatim + README). Ver
  peculiaridade dos namespaces W3C (`https`→normalização em memória) no
  README da pasta.
- **Validação XSD**: `desktop/electron/diploma-digital/xsd-validator.ts`
  (xmllint-wasm — libxml2/WASM, sem binário nativo; roda no main process e
  em teste/CI). Carrega os XSDs com `preload` das dependências (cadeia
  include/import) e devolve erros estruturados (linha + mensagem).
- **Geração**: main process do Electron (Node) — **nunca** no renderer
  (M3: `gerar-diploma-xml.ts` etc., com `mapeamento-campos.ts` como única
  fonte de verdade campo↔tabela↔transformação).
- **Banco local**: 6 tabelas novas em `database.ts`
  (`ies`, `cursos`, `diplomas_digitais`, `diploma_arquivos`,
  `diploma_assinaturas`, `auditoria_diploma`) — JSONB/TEXT para atos
  regulatórios e endereços espelhando os tipos do XSD.
- **Nuvem**: `supabase-diploma-digital.sql` (mesmas tabelas + policies
  `authenticated` + realtime) e **bucket privado** `diplomas-digitais`
  (Storage) para XMLs/PDFs oficiais — acesso só por URL assinada.
- **Sync**: as 6 tabelas entram em `TABELAS_SINCRONIZADAS` no M2, **após**
  aplicar o SQL na nuvem (sequência documentada no checklist do repo).

## 6. Segurança

- Chave privada/PIN de certificado **nunca** saem do token/`userData` (o
  módulo guarda apenas `cert_serial`/thumbprint — nunca a chave).
- Nada de credenciais no renderer nem no repositório; secrets via env/
  `userData` (padrão existente do app).
- XMLs no bucket privado (LGPD); a consulta pública (M4) expõe apenas os
  campos permitidos, via código de validação.
- Auditoria append-only de todas as ações (`auditoria_diploma`).

## 7. Dependências externas / configurações necessárias

| Item | Quem fornece | Uso |
|---|---|---|
| Certificado A1/A3 ICP-Brasil da IES | AC (ex.: FENACON/SESCAP) | Assinatura XAdES (M4) |
| IES Registradora habilitada | Contrato institucional | Registro (M4) |
| e-MEC da IES/cursos, atos regulatórios | Secretaria da IES | Cadastro institucional (M2) |
| Carimbo do tempo (se exigido pela política da IN) | TSA contratada | XAdES-T (M4) |

## 8. Atualização dos schemas

Ver `schemas/v1.05/README.md` — nova versão = nova pasta `vX.YZ` + registro
no `xsd-validator.ts`; versões anteriores permanecem para validar diplomas
já emitidos (`versao_schema` por diploma/arquivo).

## 9. Testes

- `desktop/electron/diploma-digital/xsd-validator.spike.test.ts` — prova da
  cadeia de XSDs oficiais + erros estruturados (M1).
- M3 adiciona: gerador × XSD (XML válido de ponta a ponta), pendências,
  permissões, duplicidade, anulação (15 cenários exigidos).

## 10. Roadmap

- **M1** ✅ XSDs oficiais + validação comprovada + tabelas + SQL nuvem + Storage + docs
- **M2** ✅ Cadastro institucional (IES/cursos/atos), página "Diplomas Digitais", pendências, sync ativo
- **M3** Geradores XML oficiais + validação XSD obrigatória no fluxo + auditoria + Storage
- **M4** Assinatura XAdES (certificado real), registro assistido (retorno da registradora), consulta pública
- **M5** Anulação/ListaDiplomasAnulados, ArquivoFiscalização, RVDD (PDF/A), validador oficial MEC no pipeline

### Detalhe do M2 (implementado)

- **Página "Diplomas Digitais"** (`desktop/src/pages/DiplomasDigitais.tsx`,
  menu para admin e operador; cadastro institucional só admin — RLS/IPC
  também exigem admin em `IES_SALVAR`/`CURSO_GRADUACAO_SALVAR`).
- **Pendências** (`diploma-digital/pendencias.ts`, 37 testes): verifica na
  ordem do XSD — CPF, sexo, nacionalidade, naturalidade (IBGE 7 dígitos +
  UF ou estrangeiro), RG+UF, nascimento, conclusão, colação, curso
  (e-MEC/modalidade/título/grau/autorização/reconhecimento) e IES
  (e-MEC/CNPJ/credenciamento/endereço). Dados faltantes são completados na
  própria tela de Pendências (colunas novas em `alunos`: `rg_uf`,
  `nome_social`, `naturalidade_codigo_ibge`, `naturalidade_uf`,
  `naturalidade_estrangeira`) — nunca inventados.
- **Normalizadores** (`diploma-digital/normalizadores.ts`): CPF/CNPJ/CEP
  (dígitos), datas → AAAA-MM-DD, sexo M/F, RG, UF, carga horária →
  HoraAula|HoraRelogio, nota 0–10|conceito — conforme `tiposBasicos_v1.05.xsd`.
- **Processo**: criação só com zero pendências (`ipc/diplomas-digitais.ts`),
  status inicial `apto`; auditoria de criação/complemento/cadastro.
- **Sync**: 6 tabelas em `TABELAS_SINCRONIZADAS` (exige
  `supabase-diploma-digital.sql` aplicado na nuvem).
