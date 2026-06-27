import { createHash } from 'node:crypto';

export interface DadosValidacao {
  n: string;
  m: string;
  c?: string;
  f?: string;
  t?: string;
  e: string;
  k?: string;
}

// URL pública no GitHub Pages — funciona de qualquer rede
const VALIDADOR_URL = 'https://vinagreblu-blip.github.io/nexa-validador/';

/** Gera a URL do QR Code com dados de validação embutidos (base64 + hash SHA-256) */
export function gerarUrlValidacao(dados: DadosValidacao): string {
  const dadosParaHash = { ...dados };
  const dadosStr = JSON.stringify(dadosParaHash);
  const hash = createHash('sha256').update(dadosStr, 'utf8').digest('hex');
  const dadosComHash = { ...dados, h: hash };
  const encoded = Buffer.from(JSON.stringify(dadosComHash)).toString('base64');
  return `${VALIDADOR_URL}?d=${encoded}`;
}
