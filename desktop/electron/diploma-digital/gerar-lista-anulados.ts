// ============================================================
// GERADOR — LISTA DE DIPLOMAS ANULADOS (XSD v1.05)
// ============================================================
// Root: ListaDiplomasAnulados → infListaDiplomasAnulados{versao,ambiente}
//   NumeroDeSequencia + IESRegistradora (completa c/ mantenedora)
//   + DiplomasAnulados (0..n: CodigoDiplomaAnulado=eMEC.eMEC.hex,
//     DataAnulacao, MotivoAnulacao ENUM oficial, AnotacaoAnulacao?)
//   + DataMaximaProximaAtualizacao + ds:Signature.
//
// Assinatura permanece ESQUELETO: a lista é assinada pela IES
// REGISTRADORA (competência dela — o sistema só prepara o arquivo).
// Motivo fora do enum → rejeita (nunca inventa/classifica sozinho).
import { el, elAttrs, documentoXml, assinaturaEstrutural } from './xml-utils';
import { normalizarData } from './normalizadores';
import { blocoIesRegistradoraCompleta } from './gerar-diploma-xml';

const MOTIVOS_VALIDOS = new Set([
  'Erro de Fato',
  'Erro de Direito',
  'Decisão Judicial',
  'Reemissão para Complemento de Informação',
  'Reemissão para Inclusão de Habilitação',
  'Reemissão para Anotaçao de Registro',
]);

export interface DiplomaAnuladoEntrada {
  codigoValidacao: string; // eMEC.eMEC.hex (TCodigoValidacao)
  dataAnulacao: string; // AAAA-MM-DD
  motivo: string; // enum TMotivoAnulacao
  anotacao?: string | null;
}

export interface EntradaListaAnulados {
  numeroSequencia: number;
  registradora: any;
  anulados: DiplomaAnuladoEntrada[];
  dataMaximaProximaAtualizacao: string; // AAAA-MM-DD
}

export function gerarListaDiplomasAnuladosXml(input: EntradaListaAnulados): string | null {
  if (!Number.isInteger(input.numeroSequencia) || input.numeroSequencia <= 0) return null;
  const dataMax = normalizarData(input.dataMaximaProximaAtualizacao);
  if (!dataMax) return null;

  // Grafia do leiaute oficial da lista: IESRegistradora (com S)
  const iesReg = blocoIesRegistradoraCompleta(input.registradora, 'IESRegistradora');
  if (!iesReg) return null;

  const entradas: string[] = [];
  for (const a of input.anulados) {
    if (!/^\d{1,}\.\d{1,}\.[a-f0-9]{12,}$/.test(a.codigoValidacao)) return null;
    const data = normalizarData(a.dataAnulacao);
    if (!data) return null;
    if (!MOTIVOS_VALIDOS.has(a.motivo)) return null;
    entradas.push(
      '<DiplomaAnulado>' +
      el('CodigoDiplomaAnulado', a.codigoValidacao) +
      el('DataAnulacao', data) +
      el('MotivoAnulacao', a.motivo) +
      (a.anotacao ? el('AnotacaoAnulacao', a.anotacao) : '') +
      '</DiplomaAnulado>'
    );
  }

  const inf =
    elAttrs('infListaDiplomasAnulados', { versao: '1.05', ambiente: 'Produção' },
      el('NumeroDeSequencia', input.numeroSequencia) +
      iesReg +
      '<DiplomasAnulados>' + entradas.join('') + '</DiplomasAnulados>' +
      el('DataMaximaProximaAtualizacao', dataMax)
    );

  return documentoXml('ListaDiplomasAnulados', inf + assinaturaEstrutural());
}
