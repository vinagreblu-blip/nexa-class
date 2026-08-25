// ============================================================
// VALIDAÇÃO XSD — Diploma Digital MEC (schemas oficiais v1.05)
// ============================================================
// Carrega os XSDs oficiais (repo: schemas/v1.05/) e valida XMLs
// contra eles via xmllint-wasm (libxml2 compilado para WASM —
// sem binário nativo, funciona no main process do Electron e em
// teste/CI). Os nomes dos arquivos seguem EXATAMENTE os
// schemaLocation internos dos XSDs (necessário para a cadeia de
// <xs:include>/<xs:import> resolver).
//
// PECULIARIDADE OFICIAL: o pacote do MEC publica os namespaces
// W3C com "https://" (https://www.w3.org/2001/XMLSchema e
// https://www.w3.org/2000/09/xmldsig#). O identificador canônico
// desses namespaces na especificação W3C é "http://" e o libxml2
// só reconhece schemas no namespace canônico ("not a schema
// document"). Os ARQUIVOS oficiais permanecem verbatim no repo;
// este adaptador normaliza APENAS esses dois namespaces W3C em
// memória antes da validação. O targetNamespace do MEC
// (https://portal.mec.gov.br/diplomadigital/arquivos-em-xsd) não
// é afetado. Os XMLs gerados pelo sistema usam os namespaces W3C
// canônicos (http://), conforme RFC 3275 — ver DIPLOMA_DIGITAL.md.
//
// NÃO alterar os XSDs oficiais. Para uma nova versão do padrão,
// criar schemas/vX.YZ/ nova e registrar em CONJUNTOS.
import fs from 'node:fs';
import path from 'node:path';
import { validateXML } from 'xmllint-wasm';

const NS_XMLSCHEMA_HTTPS = 'https://www.w3.org/2001/XMLSchema';
const NS_XMLDSIG_HTTPS = 'https://www.w3.org/2000/09/xmldsig#';

/** Normaliza namespaces W3C https→http (em memória; arquivo fica verbatim). */
function adaptarXsd(conteudo: Uint8Array): Uint8Array {
  const texto = Buffer.from(conteudo).toString('utf8');
  const normalizado = texto
    .split(NS_XMLSCHEMA_HTTPS).join('http://www.w3.org/2001/XMLSchema')
    .split(NS_XMLDSIG_HTTPS).join('http://www.w3.org/2000/09/xmldsig#');
  return new TextEncoder().encode(normalizado);
}

/** Arquivos de cada conjunto de schema (nomes = schemaLocation internos). */
const DEPENDENCIAS_COMUNS = ['tiposBasicos_v1.05.xsd', 'xmldsig-core-schema_v1.1.xsd'];
// Dependências transitivas: os leiautes referenciam leiauteDiplomaDigital
// entre si (ex.: leiauteHistoricoEscolar inclui leiauteDiplomaDigital).
const LEIAUTES_TRANSITIVOS = ['leiauteDiplomaDigital_v1.05.xsd', 'leiauteHistoricoEscolar_v1.05.xsd'];

const CONJUNTOS_V105 = {
  diploma: ['DiplomaDigital_v1.05.xsd', 'leiauteDiplomaDigital_v1.05.xsd', ...DEPENDENCIAS_COMUNS],
  documentacaoAcademica: [
    'DocumentacaoAcademicaRegistroDiplomaDigital_v1.05.xsd',
    'leiauteDocumentacaoAcademicaRegistroDiplomaDigital_v1.05.xsd',
    ...LEIAUTES_TRANSITIVOS,
    ...DEPENDENCIAS_COMUNS,
  ],
  historicoEscolar: ['HistoricoEscolarDigital_v1.05.xsd', 'leiauteHistoricoEscolar_v1.05.xsd', ...LEIAUTES_TRANSITIVOS, ...DEPENDENCIAS_COMUNS],
  curriculoEscolar: ['CurriculoEscolarDigital_v1.05.xsd', 'leiauteCurriculoEscolar_v1.05.xsd', ...LEIAUTES_TRANSITIVOS, ...DEPENDENCIAS_COMUNS],
  listaDiplomasAnulados: ['ListaDiplomasAnulados_v1.05.xsd', 'leiauteListaDiplomasAnulados_v1.05.xsd', ...LEIAUTES_TRANSITIVOS, ...DEPENDENCIAS_COMUNS],
  arquivoFiscalizacao: ['ArquivoFiscalizacao_v1.05.xsd', 'leiauteArquivoFiscalizacao_v1.05.xsd', ...LEIAUTES_TRANSITIVOS, ...DEPENDENCIAS_COMUNS],
} as const;

const CONJUNTOS: Record<string, Record<string, readonly string[]>> = {
  '1.05': CONJUNTOS_V105,
};

export type ArtefatoXsd = keyof typeof CONJUNTOS_V105;

export interface ResultadoValidacao {
  valido: boolean;
  versaoSchema: string;
  artefato: ArtefatoXsd;
  erros: string[];
  validadoEm: string;
}

function dirSchemas(versao: string): string {
  // dev: <repo>/schemas/vX.YZ — em produção (ASAR) os schemas são
  // empacotados em extraResources (ver DIPLOMA_DIGITAL.md).
  const dirVersao = `v${versao}`;
  const candidatos = [
    path.join(process.resourcesPath ?? '', 'schemas', dirVersao),
    path.resolve(__dirname, '..', '..', '..', 'schemas', dirVersao),
    path.resolve(process.cwd(), 'schemas', dirVersao),
  ];
  for (const c of candidatos) {
    try {
      if (fs.existsSync(path.join(c, 'tiposBasicos_v' + versao + '.xsd'))) return c;
    } catch { /* ignora */ }
  }
  return candidatos[1];
}

/** Valida um XML (string) contra o schema oficial do artefato. */
export async function validarXmlContraXsd(
  xml: string,
  artefato: ArtefatoXsd,
  versao = '1.05'
): Promise<ResultadoValidacao> {
  const versaoConjunto = CONJUNTOS[versao];
  if (!versaoConjunto) throw new Error(`Versão de schema não suportada: ${versao}`);
  const arquivos = versaoConjunto[artefato];
  if (!arquivos) throw new Error(`Artefato desconhecido: ${artefato}`);

  const dir = dirSchemas(versao);
  const [entrada, ...dependencias] = arquivos;
  const ler = (nome: string) => adaptarXsd(new Uint8Array(fs.readFileSync(path.join(dir, nome))));

  const res = await validateXML({
    xml: { fileName: 'documento.xml', contents: xml },
    schema: { fileName: entrada, contents: ler(entrada) },
    // Dependências (include/import) entram no FS em memória do xmllint,
    // resolvidas pelo schemaLocation com o nome exato do arquivo.
    preload: dependencias.map((nome) => ({ fileName: nome, contents: ler(nome) })),
  });

  return {
    valido: res.valid === true,
    versaoSchema: versao,
    artefato,
    erros: (res.errors ?? []).map((e) => (e as any).rawMessage ?? String(e)),
    validadoEm: new Date().toISOString(),
  };
}
