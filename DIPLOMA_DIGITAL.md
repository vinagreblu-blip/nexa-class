# DIPLOMA DIGITAL MEC — Documentação Técnica do Módulo

> Estado: **M1–M5 concluídos** — módulo completo: fundação, UI+sync,
> geração/validação XML oficial, assinatura real + registro + consulta
> pública, relatórios oficiais (Lista Anulados/Fiscalização), RVDD e
> registro de validação manual no validador oficial do MEC.

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
| Carimbo do tempo (TSA RFC 3161) | Fornecedor do certificado/ACT (configurável em Assinatura Digital → Carimbo do Tempo) | XAdES-T: carimba cada assinatura real (Histórico e DA) logo após criada — o token em `EncapsulatedTimeStamp` atesta a hora por terceiro auditado (nunca fabricado pelo app); sem TSA/falha → XAdES-BES com aviso de pendência |

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
- **M3** ✅ Geradores XML oficiais + validação XSD obrigatória no fluxo + auditoria + Storage
- **M4** ✅ Assinatura XAdES-BES real em A1 e A3 (digest assinado DENTRO do token via SignHash; ds canônico `http://`, como o validador oficial compila), registro assistido (Diploma final XSD-válido), consulta pública `/d/:codigo`, anulação soft
- **M5** ✅ ListaDiplomasAnulados (XML oficial, XSD-válido), ArquivoFiscalização (signed URLs https), RVDD (PDF+QR), validação manual no validador oficial MEC

### Detalhe do M3 (implementado)

- **Mapa de campos** (`mapeamento-campos.ts`): única fonte de verdade
  CAMPO OFICIAL → TABELA → COLUNA → TRANSFORMAÇÃO → ELEMENTO XML, com enums
  TTitulacao/TFormaAcessoCurso e derivação documentada (código de disciplina
  por slug; endereço do curso com fallback para o da IES).
- **Geradores** (funções puras sobre snapshot do banco):
  `gerar-historico-xml.ts` → `DocumentoHistoricoEscolarFinal`;
  `gerar-documentacao-academica.ts` → `DocumentacaoAcademicaRegistro/RegistroReq`
  (DadosDiploma com `id="Dip{44}"`, Filiacao, histórico embutido e PDFs da
  documentação comprobatória em base64). O **Diploma final** (DadosDiploma +
  DadosRegistro) só é montado após o retorno da registradora (M4).
- **Validação real**: os testes geram XML de fixture e validam contra os
  **XSDs oficiais** (`geracao-xml.test.ts`) — ambos os artefatos PASSAM.
- **Fluxo no handler** (`ipc/diplomas-digitais.ts` GERAR_XML): pendências
  específicas → gerar → **validar XSD** → inválido NÃO continua (status
  `xml_invalido`, erros persistidos) → válido: arquivo local
  (`userData/diplomas-digitais/{id}/`), hash SHA-256, upload best-effort ao
  bucket privado, chaves `Dip{44}`/código de validação do histórico
  persistidos na 1ª geração, status `aguardando_assinatura`, auditoria.
- **Esqueleto estrutural de assinatura**: os XSDs exigem `ds:Signature`
  presente; até o M4 o XML carrega um esqueleto (digest/valor vazios) APENAS
  para satisfazer o schema — o status deixa claro que NÃO há assinatura.

### Detalhe do M4 (implementado)

- **Assinatura REAL** (`xades-signer.ts`): XAdES-BES — 2 references
  (alvo com enveloped+C14N e `xades:SignedProperties` com
  SigningTime + SigningCertificate digest SHA-256), KeyInfo com
  certificado X509 completo, RSA-SHA256. Assina por POSIÇÃO
  (esqueleto com SignatureValue vazio), na ordem: Histórico 1×, DA 2×
  (ambas da emissora). **Reference por elemento**: quando o ancestral
  da assinatura tem `@id` (ex.: DadosDiploma `id="Dip{44}"`) a
  Reference é `URI="#Dip{44}"` e o digest cobre a SUBÁRVORE — é o que
  impede que a 2ª assinatura (raiz, `URI=""`) invalide a 1ª e o que
  mantém a assinatura da emissora verificável no Diploma final, onde o
  DadosDiploma é transplantado byte-idêntito. **Conformidade X509**:
  `X509SerialNumber` em DECIMAL (xs:integer) e `X509IssuerName` em
  RFC2253 (ordem invertida + escaping). **Prova de interoperabilidade**:
  round-trip com `xml-crypto checkSignature` (motor independente,
  transform enveloped próprio que remove a assinatura CERTA quando há
  várias — ver `verificador-teste.ts`) em histórico (1 assinatura), DA (2
  assinaturas) e assinatura transplantada no Diploma final;
  revalidação XSD junto (testes `xades-signer.test.ts`,
  `diploma-final.test.ts`).
- **A1**: extração do .pfx (node-forge) e assinatura em Node puro.
- **A3**: o digest SHA-256 do SignedInfo (C14N) é assinado DENTRO do
  token via `SignHash` bruto PKCS#1 v1.5 (`assinarHashA3` — PowerShell,
  precheck/vigia de PIN/timeout reutilizados); a chave NUNCA sai do
  hardware e o resultado criptográfico é idêntico ao do A1
  (comprovado em teste com mock que reproduz o SignHash:
  DigestInfo DER + PKCS#1 v1.5 — o caminho PowerShell real com token
  físico permanece smoke-test manual na 1ª assinatura). O
  certificado público do KeyInfo é exportado em PEM do próprio Windows
  Store. **Pendência de conformidade documentada**: política XAdES-EPES
  — suporte OPCIONAL implementado (`politica: { identificador,
  digestBase64 }` em `OpcoesAssinaturaXades` →
  `SignaturePolicyIdentifier`); ligar somente com o identificador
  oficial da IN-05 E o digest SHA-256 do documento da política
  confirmados (o SigPolicyHash é obrigatório no EPES — não se inventa).
- **Registro assistido** (`gerar-diploma-xml.ts` + handler): grava o
  RETORNO da registradora (livro/folha/nº/datas/responsável/
  CodigoValidacao `eMEC.eMEC.hex`), monta o **Diploma final**
  (VDip{44}, DadosDiploma extraído byte-idêntito da DA assinada +
  DadosRegistro RDip{44}) e **valida contra o XSD** — as assinaturas da
  REGISTRADORA permanecem esqueleto (competência dela; jamais
  simuladas). Exige IES Registradora cadastrada com mantenedora.
- **Consulta pública**: `POST /api/diplomas` (x-api-key) + `GET
  /d/:codigo` no verificacao-web com dados mínimos (LGPD). Publicação
  pelo app muda status para `publicado`. **Exige redeploy do serviço**
  (Render/Fly) para a rota nova.
- **Anulação** (admin + senha master): soft — status `anulado` +
  motivo + data + usuário + auditoria; documento e histórico NUNCA são
  apagados.
- **Nuvem**: `supabase-diploma-digital.sql` atualizado (chave_req,
  ato_autorizacao_registro_json — reaplicar).

### Detalhe do M5 (implementado)

- **Lista de Diplomas Anulados** (`gerar-lista-anulados.ts`): XML oficial
  `ListaDiplomasAnulados` com NumeroDeSequencia + IESRegistradora completa +
  anulados (código `eMEC.eMEC.hex`, data, **motivo da enumeração oficial
  TMotivoAnulacao** — fora do enum rejeita — e anotação opcional) +
  DataMaximaProximaAtualizacao. A assinatura fica ESQUELETO: quem assina é
  a REGISTRADORA. **Valida contra o XSD oficial** (testes).
- **Arquivo de Fiscalização** (`gerar-arquivo-fiscalizacao.ts`): XML oficial
  `ArquivoFiscalizacao` (variante emissora) por período: cada diploma
  registrado entra com CodigoDiploma, CPFDetentor, e-MEC do curso e **URLs
  https** (THttpsURL obrigatório) — signed URLs do Supabase Storage (7 dias
  de validade; limitação documentada). Sem RVDD gerada ou sem nuvem → o
  diploma NÃO entra (anti-invenção). **Valida contra o XSD oficial**.
- **RVDD** (`gerar-rvdd.ts`): PDF visual (pdfkit) com dados oficiais + QR
  apontando para a consulta pública `/d/:codigo` + chave de acesso VDip.
  Gravada no bucket privado (alimenta a URLRVDD da fiscalização).
  **Pendência de conformidade**: PDF/A-1b não afirmado — exige OutputIntent
  ICC + verificação veraPDF (registrado em `diploma_arquivos` com
  `valido_xsd=NULL` e nota da pendência).
- **Validador oficial MEC**: botão abre
  `verificadordiplomadigital.mec.gov.br/diploma`; o resultado da conferência
  MANUAL é registrado em `validado_mec_em` + auditoria (o app não integra
  com o validador do MEC — a conformidade estrutural é uma etapa, e a
  conferência oficial fica registrada como trilha).
  **"Validar Diploma Digital" (local, consolidado)**: botão por arquivo no
  modal de detalhe roda o validador próprio (`validar-artefato.ts`) e abre
  a tela de diagnóstico — XSD oficial (erros estruturados com
  elemento/linha), verificação criptográfica por assinatura (digests+RSA
  contra o certificado do KeyInfo), XAdES (SigningTime/CertDigest/PolicyId),
  carimbo do tempo (token RFC 3161 parseado: ACT, genTime e assinatura do
  token verificada contra o certificado da TSA EMBUTIDO — cadeia ICP-Brasil
  e OCSP/CRL são pendências), certificado (validade/uso/algoritmo/serial),
  hash SHA-256 e veredito **APROVADO/REJEITADO**. O fluxo de assinatura só
  marca "assinado" se a verificação criptográfica passar.
  **Comportamento comprovado empiricamente (27/08/2026, validator 1.5.15)**:
  o schema compilado do serviço usa o XMLDSig canônico `http://` — documento
  com `ds` em `https` é rejeitado na raiz ("Não pode localizar a declaração
  do elemento …"); com `http://`, a validação de conteúdo roda. Porém o
  endpoint público atualmente **derruba a resolução do schema quando o
  documento contém `ds:Reference`** (todo documento assinado tem) — bissecção
  elemento a elemento confirmou; sem isso, nossos artefatos validam
  estruturalmente. A submissão real (e-MEC / sistema da registradora) é
  outra pilha — o arquivo para a registradora é a **DA assinada**.
- **Anulação**: motivo passou a usar a enumeração oficial (6 motivos) +
  anotação opcional; colunas `anotacao_anulacao`/`validado_mec_em`
  (SQLite + Postgres).

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
