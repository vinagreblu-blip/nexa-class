# Diploma Digital — Especificação Oficial MEC (XSD v1.05)

Este diretório contém os **XSDs oficiais do Ministério da Educação** para o
ecossistema de Diploma Digital, versão **1.05**, baixados verbatim da fonte
oficial. **NÃO editar estes arquivos.**

## Proveniência

- Página oficial: https://www.gov.br/mec/pt-br/diploma-digital/dados (Pacote XSD v1.05)
- Especificação completa: `in-05-versao-completa-anexos-i-ii-e-iii-v1-05.pdf` (IN Sesu nº 05, anexos I–III)
- Baixados em: **25/08/2026**
- Validador oficial: https://verificadordiplomadigital.mec.gov.br/diploma

## Arquivos

| Papel | Arquivo |
|---|---|
| Entrada — Diploma Digital | `DiplomaDigital_v1.05.xsd` |
| Entrada — Documentação Acadêmica p/ Emissão e Registro | `DocumentacaoAcademicaRegistroDiplomaDigital_v1.05.xsd` |
| Entrada — Histórico Escolar Digital | `HistoricoEscolarDigital_v1.05.xsd` |
| Entrada — Currículo Escolar Digital | `CurriculoEscolarDigital_v1.05.xsd` |
| Entrada — Lista de Diplomas Anulados | `ListaDiplomasAnulados_v1.05.xsd` |
| Entrada — Arquivo de Fiscalização | `ArquivoFiscalizacao_v1.05.xsd` |
| Auxiliar — tipos básicos | `tiposBasicos_v1.05.xsd` |
| Auxiliar — leiautes | `leiaute*.xsd` (7 arquivos) |
| Auxiliar — assinatura | `xmldsig-core-schema_v1.1.xsd` |

## Nomes dos arquivos

Os arquivos são renomeados em relação à URL de download para os nomes
**exatos** que os próprios XSDs referenciam em `schemaLocation` (ex.: o MEC
serve `leiautediplomadigital_v1-05.xsd`, mas o XSD referencia
`leiauteDiplomaDigital_v1.05.xsd`). Só o **nome** muda — o **conteúdo é
verbatim**. Isso é necessário para a cadeia de `<xs:include>/<xs:import>`
resolver em qualquer sistema de arquivos (incluindo Linux/CI).

## Peculiaridade oficial (importante)

O pacote do MEC declara os namespaces **W3C com `https://`**
(`https://www.w3.org/2001/XMLSchema` e `https://www.w3.org/2000/09/xmldsig#`),
enquanto o identificador canônico desses namespaces é `http://`. O libxml2
(usado pelo validador do app, xmllint-wasm) só aceita a forma canônica.
O aplicativo normaliza **apenas esses dois namespaces W3C** em memória,
no adaptador `desktop/electron/diploma-digital/xsd-validator.ts` — os
arquivos aqui permanecem intocados.

## Atualizando para uma nova versão

1. Criar `schemas/vX.YZ/` e baixar os novos XSDs oficiais (mesmo critério de
   nomes = schemaLocation interno).
2. Registrar o novo conjunto em `CONJUNTOS` do `xsd-validator.ts`.
3. NÃO remover a versão anterior: diplomas emitidos referenciam a versão
   com que foram gerados (`versao_schema`).
