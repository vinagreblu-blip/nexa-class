import { getBaseUrl } from './tunnel';

// Histórico deste módulo:
//   Antes: o QR embutia os dados do documento (nome/matricula/etc.) em base64 + um hash
//   SHA-256 puro (sem segredo). Como não havia HMAC, qualquer atacante podia forjar um
//   QR "Documento Autêntico" com dados arbitrários — bastava recalcular o hash.
//
//   Agora: o QR aponta apenas para o endpoint público /v/:codigo no serviço de verificação
//   embutido no app. O servidor faz lookup do codigo_verificacao no banco e só então
//   renderiza a página de "Documento Autêntico". Não há como forjar sem acesso ao DB.
//
//   Para QRs funcionarem fora da rede local, habilite o túnel pinggy via env
//   NEXA_ENABLE_TUNNEL=1 (ver tunnel.ts). Caso contrário, funcionam apenas na mesma rede.

export interface DadosValidacao {
  // Campos legados — aceitos por compatibilidade, mas ignorados na nova implementação.
  n?: string;
  m?: string;
  c?: string;
  f?: string;
  t?: string;
  e?: string;
  // Código de verificação único do documento (UUID-like). Usado para formar a URL.
  k?: string;
  codigo?: string;
}

/** Gera a URL pública do QR Code — aponta ao endpoint server-side /v/:codigo. */
export function gerarUrlValidacao(dados: DadosValidacao): string {
  const codigo = dados.codigo ?? dados.k ?? '';
  if (!codigo) throw new Error('gerarUrlValidacao: código de vericação ausente');
  const base = getBaseUrl().replace(/\/+$/, '');
  return `${base}/v/${encodeURIComponent(codigo)}`;
}

/**
 * Instrução exibida junto ao QR nos PDFs. Quando a URL base é um endereço
 * privado (RFC1918/loopback/link-local, típico do fallback LAN), o QR só
 * funciona na mesma rede — o texto não deve prometer "qualquer dispositivo".
 */
export function textoInstrucaoQr(url?: string): string {
  let u: URL;
  try {
    u = new URL(url ?? getBaseUrl());
  } catch {
    return 'Escaneie o QR Code para validar este documento.';
  }
  const host = u.hostname.toLowerCase();
  const ehPrivado =
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.lan') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  return ehPrivado
    ? 'Escaneie o QR Code para validar em dispositivos conectados à mesma rede.'
    : 'Escaneie o QR Code para validar em qualquer dispositivo.';
}

