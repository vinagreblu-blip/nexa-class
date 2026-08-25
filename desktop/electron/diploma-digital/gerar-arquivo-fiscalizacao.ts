// ============================================================
// GERADOR — ARQUIVO DE FISCALIZAÇÃO (XSD v1.05, IES EMISSORA)
// ============================================================
// Root: ArquivoFiscalizacao → infArquivoFiscalizacaoEmissora{versao,ambiente}
//   DataInicioFiscalizacao + IESEmissora (completa)
//   + DiplomasFiscalizados (1..n: CodigoDiploma, CPFDetentor,
//     CodigoEMECCurso?, DataEmissao, DataRegistro,
//     URLXMLdoDiplomado https, URLRVDD https, URLXMLdeRegistroAcademico?)
//   + DataFimFiscalizacao + ds:Signature (emissora — assinável no app).
//
// URLs são THttpsURL OBRIGATÓRIAS: o handler injeta signed URLs do
// Supabase Storage (https; expiram — limitação documentada). Sem URL
// real disponível, o diploma NÃO entra no arquivo (anti-invenção).
import { el, elAttrs, documentoXml, assinaturaEstrutural } from './xml-utils';
import { normalizarCpf, normalizarData } from './normalizadores';
import { blocoIesEmissora } from './gerar-historico-xml';
import type { SnapshotDiploma } from './coletor';

export interface DiplomaFiscalizadoEntrada {
  codigoValidacao: string; // eMEC.eMEC.hex
  cpfDetentor: string;
  codigoEmecCurso?: number | null;
  dataEmissao: string; // AAAA-MM-DD
  dataRegistro: string; // AAAA-MM-DD
  urlXmlDiplomado: string; // https
  urlRvdd: string; // https
  urlXmlRegistroAcademico?: string | null; // https
}

export interface EntradaFiscalizacao {
  dataInicio: string; // AAAA-MM-DD
  dataFim: string; // AAAA-MM-DD
  snapshotIes: SnapshotDiploma; // apenas para o bloco IESEmissora
  diplomas: DiplomaFiscalizadoEntrada[];
}

const RE_HTTPS = /^https:\/\/.+$/;
const RE_CODIGO = /^\d{1,}\.\d{1,}\.[a-f0-9]{12,}$/;

export function gerarArquivoFiscalizacaoXml(input: EntradaFiscalizacao): string | null {
  const inicio = normalizarData(input.dataInicio);
  const fim = normalizarData(input.dataFim);
  if (!inicio || !fim) return null;
  if (input.diplomas.length === 0) return null;

  // Grafia do leiaute oficial da fiscalização: IESEmissora (com S)
  const iesEmissora = blocoIesEmissora(input.snapshotIes, 'IESEmissora');
  if (!iesEmissora) return null;

  const entradas: string[] = [];
  for (const d of input.diplomas) {
    if (!RE_CODIGO.test(d.codigoValidacao)) return null;
    const cpf = normalizarCpf(d.cpfDetentor);
    if (!cpf) return null;
    const de = normalizarData(d.dataEmissao);
    const dr = normalizarData(d.dataRegistro);
    if (!de || !dr) return null;
    if (!RE_HTTPS.test(d.urlXmlDiplomado) || !RE_HTTPS.test(d.urlRvdd)) return null;
    if (d.urlXmlRegistroAcademico && !RE_HTTPS.test(d.urlXmlRegistroAcademico)) return null;

    entradas.push(
      '<DiplomaFiscalizado>' +
      el('CodigoDiploma', d.codigoValidacao) +
      el('CPFDetentor', cpf) +
      (d.codigoEmecCurso ? el('CodigoEMECCurso', d.codigoEmecCurso) : '') +
      el('DataEmissao', de) +
      el('DataRegistro', dr) +
      el('URLXMLdoDiplomado', d.urlXmlDiplomado) +
      el('URLRVDD', d.urlRvdd) +
      (d.urlXmlRegistroAcademico ? el('URLXMLdeRegistroAcademico', d.urlXmlRegistroAcademico) : '') +
      '</DiplomaFiscalizado>'
    );
  }

  const inf =
    elAttrs('infArquivoFiscalizacaoEmissora', { versao: '1.05', ambiente: 'Produção' },
      el('DataInicioFiscalizacao', inicio) +
      iesEmissora +
      '<DiplomasFiscalizados>' + entradas.join('') + '</DiplomasFiscalizados>' +
      el('DataFimFiscalizacao', fim)
    );

  return documentoXml('ArquivoFiscalizacao', inf + assinaturaEstrutural());
}
