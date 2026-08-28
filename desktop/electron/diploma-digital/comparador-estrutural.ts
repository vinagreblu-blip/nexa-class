// ============================================================
// COMPARADOR ESTRUTURAL — Histórico Escolar Digital × XSD OFICIAL
// ============================================================
// Compara a ESTRUTURA de um XML de histórico (hierarquia, ordem,
// obrigatoriedade, atributos required, conteúdo vazio/textual,
// estrutura da assinatura XAdES) contra o modelo derivado
// PROGRAMATICAMENTE dos XSDs oficiais v1.05 (schemas/v1.05/).
// Não há hardcode da árvore de elementos: o modelo é extraído de
// xs:sequence/xs:choice/xs:group/xs:complexContent dos leiautes —
// o mesmo padrão que o XML de referência do MEC segue.
//
// Diferença vs. xsd-validator: aquele diz "válido/inválido" (libxml2);
// este explica a divergência estrutural com caminho e esperado×encontrado
// (comparação estrutura-a-estrutura do item 30 do requisito).
//
// A assinatura ds:Signature é verificada à parte (a validação semântica
// criptográfica continua em validar-artefato.ts): aqui checa-se apenas a
// ARQUITETURA (SignedInfo/SignatureValue/KeyInfo/Object/
// QualifyingProperties/SignedProperties com Type etsi/SignaturePolicyIdentifier/
// SignatureTimeStamp+EncapsulatedTimeStamp).
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { NS_MEC } from './xml-utils';

// Reutiliza a resolução de diretório de schemas do validador XSD
// (dev, ASAR/extraResources e cwd).
import { dirSchemas } from './xsd-validator';

export type TipoDivergencia =
  | 'raiz' | 'namespace' | 'versao' | 'inesperado' | 'ordem'
  | 'obrigatorioAusente' | 'conteudo' | 'atributo' | 'assinatura';

export interface Divergencia {
  tipo: TipoDivergencia;
  caminho: string;
  esperado: string;
  encontrado?: string;
}

export interface ResultadoComparacao {
  conforme: boolean;
  versaoSchema: string;
  divergencias: Divergencia[];
  comparadoEm: string;
}

// ---------- modelo extraído do XSD ----------

interface ParticulaElemento {
  kind: 'elemento';
  nome: string;
  min: number;
  max: number;
  nomeTipo?: string;          // type= referenciado
  inline?: Particula[];       // complexType embutido no elemento
  inlineAttrs?: AtributoTipo[];
  simplesInline?: boolean;    // xs:simpleType embutido
}
interface ParticulaGrupo {
  kind: 'seq' | 'choice';
  min: number;
  max: number;
  filhos: Particula[];
}
type Particula = ParticulaElemento | ParticulaGrupo;

interface AtributoTipo { nome: string; uso: 'required' | 'optional'; }

interface ModeloXsd {
  conteudos: Map<string, Particula[]>;      // complexType → partículas
  atributos: Map<string, AtributoTipo[]>;   // complexType → atributos
  simples: Set<string>;                     // nomes de simpleType
  elementosGlobais: Map<string, string>;    // elemento global → nomeTipo
}

const XS_NS_HTTPS = 'https://www.w3.org/2001/XMLSchema';
const XS_NS_HTTP = 'http://www.w3.org/2001/XMLSchema';

function filhosDiretos(node: Element, local: string): Element[] {
  const out: Element[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && (c as Element).localName === local) out.push(c as Element);
  }
  return out;
}
function primeiroFilho(node: Element, local: string): Element | null {
  return filhosDiretos(node, local)[0] ?? null;
}
function ocorre(node: Element): { min: number; max: number } {
  const min = node.getAttribute('minOccurs');
  const max = node.getAttribute('maxOccurs');
  return {
    min: min === '' || min == null ? 1 : Number(min),
    max: max === 'unbounded' ? Infinity : max === '' || max == null ? 1 : Number(max),
  };
}

/** Extrai o modelo de um conjunto de documentos de schema (mesmo targetNamespace). */
function extrairModelo(arquivos: string[]): ModeloXsd {
  const parser = new DOMParser();
  const conteudos = new Map<string, Particula[]>();
  const atributos = new Map<string, AtributoTipo[]>();
  const simples = new Set<string>();
  const elementosGlobais = new Map<string, string>();
  const grupos = new Map<string, ParticulaGrupo>();

  const docs = arquivos.map((a) => parser.parseFromString(a, 'text/xml'));
  const todosElements = (local: string): Element[] =>
    docs.flatMap((d) => {
      const out: Element[] = [];
      const lista = d.getElementsByTagNameNS(XS_NS_HTTPS, local);
      for (let i = 0; i < lista.length; i++) out.push(lista.item(i) as Element);
      const lista2 = d.getElementsByTagNameNS(XS_NS_HTTP, local);
      for (let i = 0; i < lista2.length; i++) out.push(lista2.item(i) as Element);
      return out;
    });

  function particulasDe(container: Element): Particula[] {
    const out: Particula[] = [];
    for (let c = container.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const el = c as Element;
      const oc = ocorre(el);
      switch (el.localName) {
        case 'sequence':
          out.push({ kind: 'seq', ...oc, filhos: particulasDe(el) });
          break;
        case 'choice':
          out.push({ kind: 'choice', ...oc, filhos: particulasDe(el) });
          break;
        case 'group': {
          const g = grupos.get(el.getAttribute('ref') ?? '');
          if (g) out.push({ ...g, min: el.hasAttribute('minOccurs') ? oc.min : g.min, max: el.hasAttribute('maxOccurs') ? oc.max : g.max });
          break;
        }
        case 'element': {
          if (el.getAttribute('ref')) break; // ds:Signature — tratado à parte
          const p: ParticulaElemento = {
            kind: 'elemento', nome: el.getAttribute('name') ?? '', ...oc,
            nomeTipo: el.getAttribute('type') ?? undefined,
          };
          const ct = primeiroFilho(el, 'complexType');
          if (ct) {
            p.inline = particulasDe(ct);
            p.inlineAttrs = attrsDe(ct);
          }
          if (primeiroFilho(el, 'simpleType')) p.simplesInline = true;
          out.push(p);
          break;
        }
      }
    }
    return out;
  }

  function attrsDe(ct: Element): AtributoTipo[] {
    return filhosDiretos(ct, 'attribute').map((a) => ({
      nome: a.getAttribute('name') ?? '',
      uso: a.getAttribute('use') === 'required' ? 'required' : 'optional',
    }));
  }

  // grupos primeiro (podem referenciar-se entre si)
  for (const g of todosElements('group')) {
    const nome = g.getAttribute('name');
    if (!nome) continue;
    grupos.set(nome, { kind: 'choice', min: 1, max: 1, filhos: particulasDe(g) });
  }

  for (const st of todosElements('simpleType')) {
    const n = st.getAttribute('name');
    if (n) simples.add(n);
  }
  for (const ge of todosElements('element')) {
    const n = ge.getAttribute('name');
    const t = ge.getAttribute('type');
    if (n && t && (!ge.parentNode || (ge.parentNode as Element).localName === 'schema')) {
      elementosGlobais.set(n, t);
    }
  }
  for (const ct of todosElements('complexType')) {
    const nome = ct.getAttribute('name');
    if (!nome) continue;
    const cc = primeiroFilho(ct, 'complexContent');
    const sc = primeiroFilho(ct, 'simpleContent');
    if (cc) {
      const ext = primeiroFilho(cc, 'extension') ?? primeiroFilho(cc, 'restriction');
      if (ext) {
        const base = ext.getAttribute('base');
        const herdadas = (base && conteudos.get(base)) ?? [];
        conteudos.set(nome, [...(herdadas as Particula[]), ...particulasDe(ext)]);
        const attrsBase = (base && atributos.get(base)) ?? [];
        atributos.set(nome, [...(attrsBase as AtributoTipo[]), ...attrsDe(ext), ...filhosDiretos(cc, 'attribute').map((a) => ({
          nome: a.getAttribute('name') ?? '',
          uso: a.getAttribute('use') === 'required' ? 'required' as const : 'optional' as const,
        }))]);
        continue;
      }
    }
    conteudos.set(nome, particulasDe(ct));
    if (!sc) atributos.set(nome, attrsDe(ct));
  }
  return { conteudos, atributos, simples, elementosGlobais };
}

/** Conteúdo (partículas) do tipo de um elemento — inline, referenciado ou vazio. */
function conteudoDoElemento(p: ParticulaElemento, m: ModeloXsd): Particula[] {
  if (p.inline) return p.inline;
  if (p.nomeTipo) return m.conteudos.get(p.nomeTipo) ?? [];
  return [];
}
/** true quando o elemento aceita texto (tipo simples) — ex.: Nome, CPF. */
function aceitaTexto(p: ParticulaElemento, m: ModeloXsd): boolean {
  if (p.simplesInline) return true;
  if (!p.nomeTipo) return true; // sem type → qualquer conteúdo
  return m.simples.has(p.nomeTipo);
}
function attrsDoElemento(p: ParticulaElemento, m: ModeloXsd): AtributoTipo[] {
  if (p.inlineAttrs) return p.inlineAttrs;
  if (p.nomeTipo) return m.atributos.get(p.nomeTipo) ?? [];
  return [];
}

// ---------- caminhada comparativa ----------

function elementosFilhos(node: Element): Element[] {
  const out: Element[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1) out.push(c as Element);
  }
  return out;
}
function temTexto(node: Element): boolean {
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3 && (c.nodeValue ?? '').trim() !== '') return true;
  }
  return false;
}
function caminhoFn(base: string, node: Element): string {
  return `${base}/${node.localName}`;
}

/** Tenta casar uma partícula de elemento com o nó corrente. */
function casaElemento(p: ParticulaElemento, node: Element): boolean {
  return p.nome === node.localName;
}

function nomesEsperados(particles: Particula[]): Set<string> {
  const out = new Set<string>();
  for (const p of particles) {
    if (p.kind === 'elemento') out.add(p.nome);
    else for (const n of nomesEsperados(p.filhos)) out.add(n);
  }
  return out;
}

interface Ctx {
  m: ModeloXsd;
  divs: Divergencia[];
}

/** Valida os filhos de `node` contra `particles` (contexto sequence),
 *  consumindo nós em ordem e reportando divergências. */
function validarSequencia(ctx: Ctx, particles: Particula[], node: Element, caminhoBase: string): void {
  if (process.env.DEBUG_COMPARADOR) console.log('[walk]', caminhoBase, 'particulas:', particles.map((p) => p.kind === 'elemento' ? p.nome : p.kind).join(','));
  const filhos = elementosFilhos(node).filter((f) => f.namespaceURI !== NS_DS_ASSINATURA);
  let i = 0;
  const contagens = new Map<Particula, number>();

  for (const p of particles) {
    let n = 0;
    if (p.kind === 'elemento') {
      while (i < filhos.length && n < p.max && casaElemento(p, filhos[i])) {
        validarElemento(ctx, p, filhos[i], caminhoBase);
        i++; n++;
      }
    } else {
      // seq/choice com repetição
      while (i < filhos.length && n < p.max) {
        const consumidos = tentaCasarGrupo(ctx, p, filhos, i, caminhoBase);
        if (consumidos === 0) break;
        i += consumidos; n++;
      }
      // obrigatoriedade de grupo: aproximada por min do primeiro ramo
      if (n < p.min && p.kind === 'seq') {
        const faltando = (p.filhos as ParticulaElemento[]).filter((f) => f.kind === 'elemento' && contagens.get(f) === undefined && f.min > 0);
        for (const f of faltando) {
          ctx.divs.push({
            tipo: 'obrigatorioAusente', caminho: `${caminhoBase}/${f.nome}`,
            esperado: `elemento obrigatório <${f.nome}> (minOccurs ${f.min})`, encontrado: 'ausente',
          });
        }
      }
    }
    contagens.set(p, n);
    if (p.kind === 'elemento' && n < p.min) {
      ctx.divs.push({
        tipo: 'obrigatorioAusente', caminho: `${caminhoBase}/${p.nome}`,
        esperado: `elemento obrigatório <${p.nome}> (minOccurs ${p.min})`, encontrado: 'ausente',
      });
    }
  }

  // nós remanescentes: fora de ordem ou não previstos no leiaute
  const esperados = nomesEsperados(particles);
  for (; i < filhos.length; i++) {
    const f = filhos[i];
    ctx.divs.push(
      esperados.has(f.localName)
        ? {
            tipo: 'ordem', caminho: `${caminhoBase}/${f.localName}`,
            esperado: `ordem dos elementos conforme o leiaute (${[...esperados].join(', ')})`,
            encontrado: `<${f.localName}> fora da posição prevista`,
          }
        : {
            tipo: 'inesperado', caminho: `${caminhoBase}/${f.localName}`,
            esperado: 'somente elementos previstos no leiaute oficial',
            encontrado: `<${f.localName}> não previsto`,
          }
    );
  }
}

/** Casa um grupo (seq ou choice) começando em filhos[i]; retorna nº de nós consumidos (0 = não casou). */
function tentaCasarGrupo(ctx: Ctx, g: ParticulaGrupo, filhos: Element[], i: number, caminhoBase: string): number {
  if (g.kind === 'choice') {
    const f = filhos[i];
    if (!f) return 0;
    const ramo = g.filhos.find((p) => p.kind === 'elemento' && casaElemento(p, f));
    if (!ramo) return 0;
    validarElemento(ctx, ramo as ParticulaElemento, f, caminhoBase);
    return 1;
  }
  // sequence interna: casa cada partícula em ordem
  let j = i;
  let ok = true;
  for (const p of g.filhos) {
    if (p.kind === 'elemento') {
      if (j < filhos.length && casaElemento(p, filhos[j])) {
        validarElemento(ctx, p, filhos[j], caminhoBase);
        j++;
      } else if (p.min > 0) { ok = false; break; }
    } else {
      const c = tentaCasarGrupo(ctx, p, filhos, j, caminhoBase);
      if (c === 0 && p.min > 0) { ok = false; break; }
      j += c;
    }
  }
  return ok ? j - i : 0;
}

function validarElemento(ctx: Ctx, p: ParticulaElemento, node: Element, caminhoBase: string): void {
  const caminho = caminhoFn(caminhoBase, node);
  const conteudo = conteudoDoElemento(p, ctx.m);

  // conteúdo textual/estrutura
  if (conteudo.length === 0) {
    if (!aceitaTexto(p, ctx.m) && temTexto(node)) {
      ctx.divs.push({
        tipo: 'conteudo', caminho,
        esperado: `elemento vazio (sem texto) conforme o leiaute`,
        encontrado: `texto "${node.textContent?.trim()}"`,
      });
    }
  } else {
    if (temTexto(node)) {
      ctx.divs.push({
        tipo: 'conteudo', caminho,
        esperado: 'apenas elementos filhos (sem texto misto)',
        encontrado: `texto "${node.textContent?.trim().slice(0, 40)}"`,
      });
    }
    validarSequencia(ctx, conteudo, node, caminho);
  }

  // atributos obrigatórios
  for (const a of attrsDoElemento(p, ctx.m)) {
    if (a.uso === 'required' && !node.hasAttribute(a.nome)) {
      ctx.divs.push({
        tipo: 'atributo', caminho,
        esperado: `atributo obrigatório @${a.nome}`, encontrado: 'ausente',
      });
    }
  }
}

// ---------- assinatura ds:Signature (estrutura arquitetural) ----------

const NS_DS_ASSINATURA = 'http://www.w3.org/2000/09/xmldsig#';
const NS_DS_ASSINATURA_HTTPS = 'https://www.w3.org/2000/09/xmldsig#';
// const NS_XADES = 'http://uri.etsi.org/01903/v1.3.2#'; // (usado via xades:QualifyingProperties no matching abaixo)
const TYPE_SIGNED_PROPERTIES = 'http://uri.etsi.org/01903#SignedProperties';

function ehAssinatura(node: Element): boolean {
  return node.localName === 'Signature' &&
    (node.namespaceURI === NS_DS_ASSINATURA || node.namespaceURI === NS_DS_ASSINATURA_HTTPS);
}
function descendente(node: Element, ...caminho: string[]): Element | null {
  let atual = node;
  for (const nome of caminho) {
    let achou: Element | null = null;
    for (const f of elementosFilhos(atual)) {
      if (f.localName === nome) { achou = f; break; }
    }
    if (!achou) return null;
    atual = achou;
  }
  return atual;
}

function validarEstruturaAssinatura(ctx: Ctx, assinatura: Element, indice: number): void {
  const base = `ds:Signature[${indice}]`;
  if (!descendente(assinatura, 'SignedInfo')) {
    ctx.divs.push({ tipo: 'assinatura', caminho: base, esperado: 'ds:SignedInfo presente', encontrado: 'ausente' });
  } else {
    if (!descendente(assinatura, 'SignedInfo', 'CanonicalizationMethod')) {
      ctx.divs.push({ tipo: 'assinatura', caminho: `${base}/ds:SignedInfo`, esperado: 'ds:CanonicalizationMethod', encontrado: 'ausente' });
    }
    if (!descendente(assinatura, 'SignedInfo', 'SignatureMethod')) {
      ctx.divs.push({ tipo: 'assinatura', caminho: `${base}/ds:SignedInfo`, esperado: 'ds:SignatureMethod', encontrado: 'ausente' });
    }
  }
  if (!descendente(assinatura, 'SignatureValue')) {
    ctx.divs.push({ tipo: 'assinatura', caminho: base, esperado: 'ds:SignatureValue presente', encontrado: 'ausente' });
  }

  // XAdES: QualifyingProperties/SignedProperties + Reference Type=etsi
  const qp = descendente(assinatura, 'Object', 'QualifyingProperties');
  if (qp) {
    const sp = descendente(qp, 'SignedProperties', 'SignedSignatureProperties');
    if (!sp) {
      ctx.divs.push({ tipo: 'assinatura', caminho: `${base}/QualifyingProperties`, esperado: 'xades:SignedProperties/xades:SignedSignatureProperties', encontrado: 'ausente' });
    } else {
      for (const esperado of ['SigningTime', 'SigningCertificate', 'SignaturePolicyIdentifier']) {
        if (!descendente(sp, esperado)) {
          ctx.divs.push({ tipo: 'assinatura', caminho: `${base}/SignedSignatureProperties`, esperado: `xades:${esperado}`, encontrado: 'ausente' });
        }
      }
    }
    const refs = descendente(assinatura, 'SignedInfo', 'Reference');
    // Type=SignedProperties em alguma Reference (procura em todos os filhos)
    let temRefSp = false;
    const si = descendente(assinatura, 'SignedInfo');
    if (si) {
      for (const r of elementosFilhos(si).filter((f) => f.localName === 'Reference')) {
        if (r.getAttribute('Type') === TYPE_SIGNED_PROPERTIES) temRefSp = true;
      }
    }
    void refs;
    if (!temRefSp) {
      ctx.divs.push({
        tipo: 'assinatura', caminho: `${base}/ds:SignedInfo/ds:Reference`,
        esperado: `Reference com Type="${TYPE_SIGNED_PROPERTIES}"`,
        encontrado: 'ausente',
      });
    }
    // UnsignedProperties: quando presente, SignatureTimeStamp com token
    const tsp = descendente(qp, 'UnsignedProperties', 'UnsignedSignatureProperties', 'SignatureTimeStamp');
    if (tsp) {
      const token = descendente(tsp, 'EncapsulatedTimeStamp');
      if (!token || (token.textContent ?? '').trim() === '') {
        ctx.divs.push({
          tipo: 'assinatura', caminho: `${base}/SignatureTimeStamp/EncapsulatedTimeStamp`,
          esperado: 'token RFC 3161 real (não vazio)', encontrado: 'vazio/ausente',
        });
      }
    }
  }
}

// ---------- API ----------

/** Compara a estrutura do XML do Histórico Escolar Digital contra o
 *  XSD oficial (schemas/v1.05). Síncrona — lê os XSDs do disco. */
export function compararEstruturaHistorico(xml: string, versao = '1.05'): ResultadoComparacao {
  const divs: Divergencia[] = [];
  const base: ResultadoComparacao = {
    conforme: false, versaoSchema: versao, divergencias: divs, comparadoEm: new Date().toISOString(),
  };

  const dir = dirSchemas(versao);
  const ler = (nome: string) => fs.readFileSync(path.join(dir, nome), 'utf8');
  const modelo = extrairModelo([
    ler(`HistoricoEscolarDigital_v${versao}.xsd`),
    ler(`leiauteHistoricoEscolar_v${versao}.xsd`),
    ler(`leiauteDiplomaDigital_v${versao}.xsd`),
    ler(`tiposBasicos_v${versao}.xsd`),
  ]);

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'text/xml');
  } catch (e: any) {
    divs.push({ tipo: 'raiz', caminho: '/', esperado: 'XML bem formado', encontrado: e?.message ?? 'erro de parse' });
    return base;
  }
  const raiz = doc.documentElement;
  if (!raiz) {
    divs.push({ tipo: 'raiz', caminho: '/', esperado: 'elemento raiz DocumentoHistoricoEscolarFinal', encontrado: 'documento vazio' });
    return base;
  }
  if (raiz.localName !== 'DocumentoHistoricoEscolarFinal') {
    divs.push({
      tipo: 'raiz', caminho: `/${raiz.localName}`,
      esperado: 'raiz <DocumentoHistoricoEscolarFinal>',
      encontrado: `<${raiz.localName}>`,
    });
  }
  if (raiz.namespaceURI !== NS_MEC) {
    divs.push({
      tipo: 'namespace', caminho: `/${raiz.localName}`,
      esperado: `xmlns="${NS_MEC}" (namespace oficial MEC)`,
      encontrado: raiz.namespaceURI ?? 'sem namespace',
    });
  }

  // versão do leiaute no infHistoricoEscolar
  const inf = elementosFilhos(raiz).find((f) => f.localName === 'infHistoricoEscolar');
  if (!inf) {
    divs.push({ tipo: 'versao', caminho: '/DocumentoHistoricoEscolarFinal', esperado: '<infHistoricoEscolar versao="...">', encontrado: 'ausente' });
  } else if (inf.getAttribute('versao') !== versao) {
    divs.push({
      tipo: 'versao', caminho: '/DocumentoHistoricoEscolarFinal/infHistoricoEscolar',
      esperado: `versao="${versao}" (vigente no XSD oficial)`,
      encontrado: inf.getAttribute('versao') ?? 'sem atributo versao',
    });
  }

  // caminhada estrutural contra o modelo do XSD
  const nomeTipoRaiz = modelo.elementosGlobais.get('DocumentoHistoricoEscolarFinal') ?? 'TDocumentoHistoricoEscolarDigital';
  if (process.env.DEBUG_COMPARADOR) {
    console.log('[comparador] tipos complexos:', modelo.conteudos.size,
      'globais:', [...modelo.elementosGlobais.entries()],
      'raiz:', nomeTipoRaiz,
      'conteudo raiz:', JSON.stringify(modelo.conteudos.get(nomeTipoRaiz)),
      'inf:', JSON.stringify(modelo.conteudos.get('TInfHistoricoEscolar')?.slice(0, 2)));
  }
  const conteudoRaiz = modelo.conteudos.get(nomeTipoRaiz) ?? [];
  const ctx: Ctx = { m: modelo, divs };
  // valida apenas o ramo MEC (infHistoricoEscolar); ds:Signature é arquitetural
  const infParticula: ParticulaElemento = { kind: 'elemento', nome: 'infHistoricoEscolar', min: 1, max: 1 };
  if (inf) {
    const pInf = conteudoRaiz.find((p) => p.kind === 'elemento' && p.nome === 'infHistoricoEscolar') as ParticulaElemento | undefined;
    validarElemento(ctx, pInf ?? infParticula, inf, '/DocumentoHistoricoEscolarFinal');
  }

  // assinaturas ds:Signature (1..n obrigatórias)
  const assinaturas = elementosFilhos(raiz).filter(ehAssinatura);
  if (assinaturas.length === 0) {
    divs.push({ tipo: 'assinatura', caminho: '/DocumentoHistoricoEscolarFinal', esperado: 'ao menos uma ds:Signature (minOccurs 1)', encontrado: 'ausente' });
  }
  assinaturas.forEach((a, i) => validarEstruturaAssinatura(ctx, a, i + 1));

  return { ...base, conforme: divs.length === 0 };
}
