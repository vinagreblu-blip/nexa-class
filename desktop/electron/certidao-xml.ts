// ============================================================
// CERTIDÃO/DECLARAÇÃO — XML ESPELHO DO PDF (formato próprio)
// ============================================================
// Módulo PURO (string building) — testável em vitest. Espelha o
// documento emitido (PDF): mesmas informações, MESMO código de
// verificação, hash, emitente e URL pública do QR.
//
// AVISO DE NATUREZA: este XML é um formato PROPRIETÁRIO do sistema
// (namespace nexa-class.edu) — NÃO é documento do padrão MEC. O XML
// oficial aceito pelo MEC é gerado no módulo Diplomas Digitais
// (Histórico Escolar Digital / Diploma, XSD v1.05).
import { escapeXml } from './diploma-digital/xml-utils';

export interface DadosXmlEspelho {
  /** Root do documento: 'certidaoConclusao' | 'declaracaoAutenticidadeHistorico' */
  root: string;
  tituloDocumento: string;
  instituicao: { nome: string; cnpj?: string | null };
  aluno: {
    nome: string;
    matricula: string;
    cpf?: string | null;
    rg?: string | null;
    curso?: string | null;
    faculdade?: string | null;
    situacao: string; // ex.: 'Cursando' | 'Concluído'
    anoConclusao?: string | null;
    dataColacao?: string | null;
  };
  documento: {
    codigoVerificacao: string;
    hashConteudo: string;
    emitidoPor: string;
    emitidoEm: string; // ISO
    urlVerificacao: string;
  };
  /** Gerado em (ISO) — default: agora. */
  geradoEm?: string;
}

function el(tag: string, valor: string | number | null | undefined): string {
  return `<${tag}>${escapeXml(valor == null ? '' : String(valor))}</${tag}>`;
}

/** Grupo (NÃO escapa — filhos já são XML). */
function grupo(tag: string, filhos: string): string {
  return `<${tag}>${filhos}</${tag}>`;
}

/**
 * Monta o XML espelho. Retorna null se faltar o essencial
 * (código/hash/aluno) — nunca gera documento incompleto.
 */
export function gerarXmlEspelho(d: DadosXmlEspelho): string | null {
  if (!d.root || !d.aluno?.nome || !d.aluno?.matricula) return null;
  if (!d.documento?.codigoVerificacao || !d.documento?.hashConteudo) return null;

  const geradoEm = d.geradoEm ?? new Date().toISOString();

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<${d.root} xmlns="https://nexa-class.edu/certidao">` +
    grupo('cabecalho',
      el('sistema', 'NEXA CLASS') +
      el('documento', d.tituloDocumento) +
      el('natureza', 'Documento em formato próprio do sistema — não é documento do padrão MEC (Diploma Digital)') +
      el('geradoEm', geradoEm)
    ) +
    grupo('instituicao',
      el('nome', d.instituicao?.nome) +
      (d.instituicao?.cnpj ? el('cnpj', d.instituicao.cnpj) : '')
    ) +
    grupo('aluno',
      el('nome', d.aluno.nome) +
      el('matricula', d.aluno.matricula) +
      (d.aluno.cpf ? el('cpf', d.aluno.cpf) : '') +
      (d.aluno.rg ? el('rg', d.aluno.rg) : '') +
      (d.aluno.curso ? el('curso', d.aluno.curso) : '') +
      (d.aluno.faculdade ? el('faculdade', d.aluno.faculdade) : '') +
      el('situacao', d.aluno.situacao) +
      (d.aluno.anoConclusao ? el('anoConclusao', d.aluno.anoConclusao) : '') +
      (d.aluno.dataColacao ? el('dataColacao', d.aluno.dataColacao) : '')
    ) +
    grupo('verificacao',
      el('codigo', d.documento.codigoVerificacao) +
      el('hashConteudo', d.documento.hashConteudo) +
      el('emitidoPor', d.documento.emitidoPor) +
      el('emitidoEm', d.documento.emitidoEm) +
      el('url', d.documento.urlVerificacao)
    ) +
    `</${d.root}>`;

  return xml;
}
