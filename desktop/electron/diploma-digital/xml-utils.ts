// ============================================================
// XML UTILS — construção de XML oficial MEC (namespace v1.05)
// ============================================================
// Módulo PURO (string building determinístico, sem dep de DOM)
// — os documentos são pequenos e a serialização manual garante
// controle total de namespaces/escapING, exigido pela validação
// XSD (libxml2 é sensível a whitespace: este gerador NÃO indenta).
//
// ASSINATURA ESTRUTURAL: os XSDs exigem <ds:Signature> presente.
// Antes da assinatura real (XAdES, M4), os geradores embutem um
// ESQUELETO estrutural (SignedInfo/SignatureValue vazios) apenas
// para satisfazer o schema — o processo fica explicitamente no
// status "aguardando_assinatura". NUNCA é apresentado como
// assinado; ver DIPLOMA_DIGITAL.md § anti-simulação.
//

import { normalizarCep } from './normalizadores';

export const NS_MEC = 'http://portal.mec.gov.br/diplomadigital/arquivos-em-xsd';
// Namespace MEC em http:// — CONFIRMADO pelo XML de referência real aceito
// no ecossistema (diploma válido processado pela IES registradora): os XSDs
// oficiais declaram targetNamespace https, mas os DOCUMENTOS reais usam a
// forma http; parsers estritos da registradora rejeitam a forma https com
// "Dados do diploma não encontrados no XML". O validador local normaliza o
// targetNamespace dos XSDs https→http para validar fielmente (xsd-validator).
// XMLDSig CANÔNICO (http:// — RFC 3275), idem ds acima.
export const NS_DS = 'http://www.w3.org/2000/09/xmldsig#';
// XAdES 1.3.2 (namespace default local no QualifyingProperties, como o
// assinador oficial).
export const NS_XADES = 'http://uri.etsi.org/01903/v1.3.2#';

export function escapeXml(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Elemento simples: <tag>valor-escapado</tag> (sem filho). */
export function el(tag: string, valor: string | number | null | undefined): string {
  const v = valor == null ? '' : String(valor);
  return `<${tag}>${escapeXml(v)}</${tag}>`;
}

/** Elemento com atributos e filhos: <tag attr="v">filhos</tag>. */
export function elAttrs(tag: string, attrs: Record<string, string>, filhos: string): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v != null)
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join('');
  return `<${tag}${a}>${filhos}</${tag}>`;
}

/** Esqueleto estrutural de assinatura (pré-XAdES/M4) — substituído pela
 *  assinatura real ao assinar. Mesma forma que o assinador emite. */
export function assinaturaEstrutural(): string {
  return (
    `<ds:Signature xmlns:ds="${NS_DS}">` +
    '<ds:SignedInfo>' +
    '<ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>' +
    '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>' +
    '<ds:Reference URI="">' +
    '<ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/></ds:Transforms>' +
    '<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>' +
    '<ds:DigestValue></ds:DigestValue>' +
    '</ds:Reference>' +
    '</ds:SignedInfo>' +
    '<ds:SignatureValue></ds:SignatureValue>' +
    '</ds:Signature>'
  );
}

/** Cabeçalho + raiz com o namespace oficial MEC (http — como os documentos
 *  reais); ds/xades são declarados LOCALMENTE em cada Signature/Object. */
export function documentoXml(rootTag: string, conteudo: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<${rootTag} xmlns="${NS_MEC}">` +
    conteudo +
    `</${rootTag}>`
  );
}

// ---------- blocos reutilizáveis (tipos do XSD) ----------

/** TAtoRegulatorioComOuSemEMEC a partir do JSON {tipo,numero,data[,veiculo,dataPub,secao,pagina,dou]}. */
export function blocoAto(prefixoJson: string | null | undefined, tag: string): string | null {
  if (!prefixoJson) return null;
  let ato: any;
  try { ato = JSON.parse(prefixoJson); } catch { return null; }
  if (!ato?.tipo || !ato?.numero || !ato?.data) return null;
  let inner = el('Tipo', ato.tipo) + el('Numero', ato.numero) + el('Data', ato.data);
  if (ato.veiculo) inner += el('VeiculoPublicacao', ato.veiculo);
  if (ato.dataPublicacao) inner += el('DataPublicacao', ato.dataPublicacao);
  if (ato.secao != null) inner += el('SecaoPublicacao', ato.secao);
  if (ato.pagina != null) inner += el('PaginaPublicacao', ato.pagina);
  if (ato.dou != null) inner += el('NumeroDOU', ato.dou);
  return `<${tag}>${inner}</${tag}>`;
}

/** TEndereco a partir de partes (todas obrigatórias exceto numero/complemento).
 *  CEP é normalizado (8 dígitos — aceita mascarado no banco). */
export function blocoEndereco(e: {
  logradouro: string; numero?: string | null; complemento?: string | null;
  bairro: string; codigoMunicipio?: string | null; nomeMunicipio: string; uf?: string | null; cep: string;
}): string | null {
  const cep = normalizarCep(e.cep);
  if (!e.logradouro || !e.bairro || !e.nomeMunicipio || !cep) return null;
  let mun: string;
  if (e.codigoMunicipio && e.uf) {
    mun = el('CodigoMunicipio', e.codigoMunicipio) + el('NomeMunicipio', e.nomeMunicipio) + el('UF', e.uf);
  } else {
    // município estrangeiro (GMunicipio choice)
    mun = el('NomeMunicipioEstrangeiro', e.nomeMunicipio);
  }
  return (
    el('Logradouro', e.logradouro) +
    (e.numero ? el('Numero', e.numero) : '') +
    (e.complemento ? el('Complemento', e.complemento) : '') +
    el('Bairro', e.bairro) +
    mun +
    el('CEP', cep)
  );
}

/** TCargaHoraria: {horaAula} → <HoraAula>, {horaRelogio} → <HoraRelogio>. */
export function blocoCargaHoraria(ch: { horaAula: number } | { horaRelogio: number } | null): string | null {
  if (!ch) return null;
  if ('horaAula' in ch) return el('HoraAula', ch.horaAula);
  return el('HoraRelogio', ch.horaRelogio.toFixed(2));
}

/** TCargaHorariaComEtiqueta (etiqueta opcional). */
export function blocoCargaHorariaEtiqueta(
  ch: { horaAula: number } | { horaRelogio: number } | null,
  etiqueta?: string
): string | null {
  if (!ch) return null;
  const base = 'horaAula' in ch ? el('HoraAula', ch.horaAula) : el('HoraRelogio', ch.horaRelogio.toFixed(2));
  return etiqueta ? elAttrs('CargaHoraria', { etiqueta }, base) : `<CargaHoraria>${base}</CargaHoraria>`;
}

/** TDadosDiplomado (ID + GPessoa + Nacionalidade + Naturalidade + CPF + RG + Nascimento). */
export function blocoDiplomado(a: {
  matricula: string; nome: string; nomeSocial?: string | null; sexo: 'M' | 'F';
  nacionalidade: string; naturalidade: { codigoIbge?: string | null; nome: string; uf?: string | null };
  cpf: string; rg: { numero: string; orgaoExpedidor?: string | null; uf: string };
  dataNascimento: string;
}): string {
  const nat = a.naturalidade.codigoIbge && a.naturalidade.uf
    ? el('CodigoMunicipio', a.naturalidade.codigoIbge) + el('NomeMunicipio', a.naturalidade.nome) + el('UF', a.naturalidade.uf)
    : el('NomeMunicipioEstrangeiro', a.naturalidade.nome);
  const rgInner =
    el('Numero', a.rg.numero) +
    (a.rg.orgaoExpedidor ? el('OrgaoExpedidor', a.rg.orgaoExpedidor) : '') +
    el('UF', a.rg.uf);
  return (
    el('ID', a.matricula) +
    el('Nome', a.nome) +
    (a.nomeSocial ? el('NomeSocial', a.nomeSocial) : '') +
    el('Sexo', a.sexo) +
    el('Nacionalidade', a.nacionalidade) +
    `<Naturalidade>${nat}</Naturalidade>` +
    el('CPF', a.cpf) +
    `<RG>${rgInner}</RG>` +
    el('DataNascimento', a.dataNascimento)
  );
}

/** TDocentes (1..n) — Titulacao no enum TTitulacao. */
export function blocoDocentes(docentes: { nome: string; titulacao: string }[]): string | null {
  if (docentes.length === 0) return null;
  return '<Docentes>' + docentes.map((d) => el('Nome', d.nome) + el('Titulacao', d.titulacao)).map((x) => `<Docente>${x}</Docente>`).join('') + '</Docentes>';
}
