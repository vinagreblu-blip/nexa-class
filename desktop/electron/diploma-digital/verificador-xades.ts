// ============================================================
// VERIFICADOR XML-CRYPTO (xades) — round-trip independente
// ============================================================
// Transform com a semântica do XPath do padrão oficial: cada Reference é
// computada sobre o elemento SEM NENHUMA Signature dentro (remove TODAS
// as ds:Signature do nó processado — é o que o transform XPath do
// assinador oficial produz e o que o nosso assinador computa; permite
// múltiplas assinaturas independentes). Aceita o namespace ds canônico
// (http://) e a variante https (defensivo). Digests/C14N/RSA continuam
// sendo do xml-crypto (motor independente de verdade). Usado pelos
// testes E pela validação consolidada de produção
// ("Validar Diploma Digital" — validar-artefato.ts).
import { SignedXml } from 'xml-crypto';

const NS_DS_CANONICO = 'http://www.w3.org/2000/09/xmldsig#';
const NS_DS_MEC = 'https://www.w3.org/2000/09/xmldsig#';

/** Remove TODAS as assinaturas ds do nó (semântica do transform XPath
 *  not(ancestor-or-self::ds:Signature) + enveloped do padrão oficial). */
export class EnvelopedSignatureMec {
  process(node: any, _options: any): any {
    const ehAssinatura = (n: any) =>
      n?.localName === 'Signature' && (n.namespaceURI === NS_DS_CANONICO || n.namespaceURI === NS_DS_MEC);
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

/** XPath filter do padrão oficial (exclui assinaturas do digest) — no
 *  verificador é NO-OP: o EnvelopedSignatureMec já remove TODAS as
 *  assinaturas do nó (mesma semântica do XPath); o registro existe para
 *  o xml-crypto não rejeitar a pipeline de transforms. */
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
 *  NO-OP (o EnvelopedSignatureMec já remove todas as assinaturas — mesma
 *  semântica do XPath) e o exc-c14n nativo do xml-crypto. */
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
