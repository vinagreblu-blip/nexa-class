// ============================================================
// VERIFICADOR XML-CRYPTO p/ TESTES — namespace ds https do MEC
// ============================================================
// O xml-crypto só conhece o namespace XMLDSig canônico (http://);
// com a variante https (exigida pelo validador oficial do MEC) o
// transform enveloped dele NÃO remove a assinatura do digest →
// rejeição falsa. Este helper registra um transform enveloped que
// reconhece AMBAS as variantes; digests/C14N/RSA continuam sendo
// do xml-crypto (motor independente de verdade).
// Arquivo de apoio a testes — NÃO é suíte (fora do include do vitest)
// e não faz parte do runtime do app.
import { SignedXml } from 'xml-crypto';

const NS_DS_CANONICO = 'http://www.w3.org/2000/09/xmldsig#';
const NS_DS_MEC = 'https://www.w3.org/2000/09/xmldsig#';

/** Transform enveloped: remove a assinatura verificada (casada pelo
 *  SignatureValue) dentro da subárvore/documento processado. */
export class EnvelopedSignatureMec {
  process(node: any, options: any): any {
    const ehAssinatura = (n: any) =>
      n?.localName === 'Signature' && (n.namespaceURI === NS_DS_CANONICO || n.namespaceURI === NS_DS_MEC);
    const valorAssinatura = (n: any): string | null => {
      for (let i = 0; i < (n.childNodes?.length ?? 0); i++) {
        const c = n.childNodes[i];
        if (c.localName === 'SignatureValue') return c.textContent ?? null;
      }
      return null;
    };
    const esperado = options?.signatureNode ? valorAssinatura(options.signatureNode) : null;
    const visitar = (el: any): void => {
      for (let i = 0; i < (el.childNodes?.length ?? 0); i++) {
        const c = el.childNodes[i];
        if (ehAssinatura(c) && (!esperado || valorAssinatura(c) === esperado)) {
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

/** SignedXml configurado p/ o padrão MEC (ds https + @id do leiaute,
 *  além de Id/ID do XMLDSig). Já carrega o nó da assinatura. */
export function novoVerificador(certPem: string, sigNode: any): SignedXml {
  const sig = new SignedXml({ publicCert: certPem });
  sig.CanonicalizationAlgorithms['http://www.w3.org/2000/09/xmldsig#enveloped-signature'] =
    EnvelopedSignatureMec as any;
  sig.idAttributes = ['Id', 'id', 'ID'];
  sig.loadSignature(sigNode);
  return sig;
}
