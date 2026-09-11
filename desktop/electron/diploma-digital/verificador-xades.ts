// ============================================================
// VERIFICADOR XML-CRYPTO (xades) — round-trip independente
// ============================================================
// Transform enveloped com a semântica do assinador e do validador
// oficial, DIFERENCIADA por tipo de referência:
//  • Reference URI="" (alvo = elemento RAIZ do documento — assinatura
//    de ARQUIVAMENTO da DA): remove APENAS a assinatura sendo
//    verificada (match por SignatureValue, como o EnvelopedSignature
//    nativo do xml-crypto). O digest da raiz COBRE as assinaturas
//    internas de DadosDiploma (semântica enveloped XMLDSig + perfil
//    AD-RA — confirmada contra o motor .NET SignedXml).
//  • Reference por @id (alvo = sub-elemento, ex.: DadosDiploma):
//    remove TODAS as ds:Signature do nó (co-assinaturas
//    independentes — cada digest exclui as demais).
// Aceita o namespace ds canônico (http://) e a variante https
// (defensivo). Digests/C14N/RSA continuam sendo do xml-crypto (motor
// independente de verdade). Usado pelos testes E pela validação
// consolidada de produção ("Validar Diploma Digital" — validar-artefato.ts).
import { SignedXml } from 'xml-crypto';

const NS_DS_CANONICO = 'http://www.w3.org/2000/09/xmldsig#';
const NS_DS_MEC = 'https://www.w3.org/2000/09/xmldsig#';

/** SignatureValue (texto) de uma ds:Signature — identidade da
 *  assinatura para a semântica remove-self da referência raiz. */
function valorAssinatura(sig: any): string {
  for (let i = 0; i < (sig?.childNodes?.length ?? 0); i++) {
    const c = sig.childNodes[i];
    if (c.localName === 'SignatureValue') return (c.textContent ?? '').trim();
  }
  return '';
}

/** Transform enveloped do leiaute MEC (ver comentário do módulo). */
export class EnvelopedSignatureMec {
  process(node: any, options: any): any {
    const ehAssinatura = (n: any) =>
      n?.localName === 'Signature' && (n.namespaceURI === NS_DS_CANONICO || n.namespaceURI === NS_DS_MEC);
    // O xml-crypto passa ao transform um CLONE do elemento resolvido — o
    // clone não é mais o documentElement do documento. A referência de
    // RAIZ (URI="") é identificada comparando o tagName do alvo com o do
    // elemento raiz do documento ORIGINAL (alcançável via signatureNode,
    // que pertence ao documento carregado). No leiaute MEC, referências
    // por @id apontam sempre para sub-elementos (DadosDiploma,
    // DadosRegistro…) com tagName distinto da raiz.
    const raizOriginal = options?.signatureNode?.ownerDocument?.documentElement;
    const ehRefRaiz = !!raizOriginal && node?.nodeType === 1 && node.tagName === raizOriginal.tagName;
    if (ehRefRaiz) {
      // URI="": remove SOMENTE a assinatura verificada (self)
      const valorVerificado = valorAssinatura(options.signatureNode);
      const removerSelf = (el: any): void => {
        for (let i = 0; i < (el.childNodes?.length ?? 0); i++) {
          const c = el.childNodes[i];
          if (ehAssinatura(c) && valorAssinatura(c) === valorVerificado) {
            el.removeChild(c);
            i--;
            continue;
          }
          if (c.nodeType === 1) removerSelf(c);
        }
      };
      removerSelf(node);
      return node;
    }
    // Reference por @id (co-assinaturas): remove TODAS as assinaturas
    const visitar = (el: any): void => {
      for (let i = 0; i < (el.childNodes?.length ?? 0); i++) {
        const c = el.childNodes[i];
        if (ehAssinatura(c)) {
          el.removeChild(c);
          i--;
          continue;
        }
        if (c.nodeType === 1) visitar(c);
      }
    };
    visitar(node);
    return node;
  }
  getAlgorithmName(): string {
    return 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
  }
}

/** XPath filter — permanece REGISTRADO como NO-OP: assinaturas NOVAS
 *  não declaram mais o transform XPath (ele corrompia o node-set no
 *  pipeline .NET do validador oficial), mas XMLs JÁ EMITIDOS com ele
 *  continuam validando localmente (o EnvelopedSignatureMec acima já
 *  aplica a semântica correta sozinho). */
export class XPathFilterMec {
  process(node: any, _options: any): any {
    return node;
  }
  getAlgorithmName(): string {
    return 'http://www.w3.org/TR/1999/REC-xpath-19991116';
  }
}

/** SignedXml configurado p/ o leiaute MEC (@id minúsculo além de
 *  Id/ID do XMLDSig). Registra o XPath filter do padrão oficial como
 *  NO-OP (legado) e o exc-c14n nativo do xml-crypto. */
export function novoVerificador(certPem: string, sigNode: any): SignedXml {
  const sig = new SignedXml({ publicCert: publicCertPem(certPem) });
  sig.CanonicalizationAlgorithms['http://www.w3.org/2000/09/xmldsig#enveloped-signature'] =
    EnvelopedSignatureMec as any;
  sig.CanonicalizationAlgorithms['http://www.w3.org/TR/1999/REC-xpath-19991116'] =
    XPathFilterMec as any;
  sig.idAttributes = ['Id', 'id', 'ID'];
  sig.loadSignature(sigNode);
  return sig;
}

/** xml-crypto espera PEM; aceita também apenas o certificado do KeyInfo. */
function publicCertPem(cert: string): string {
  if (!cert) return cert;
  if (cert.includes('BEGIN CERTIFICATE')) return cert;
  return `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`;
}
