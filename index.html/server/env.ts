import fs from 'node:fs';
import path from 'node:path';

export function carregarEnv(arquivo = '.env'): void {
  const caminho = path.resolve(process.cwd(), arquivo);
  if (!fs.existsSync(caminho)) return;
  const conteudo = fs.readFileSync(caminho, 'utf8');
  for (const linha of conteudo.split(/\r?\n/)) {
    const trimmed = linha.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const chave = trimmed.slice(0, idx).trim();
    let valor = trimmed.slice(idx + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    if (process.env[chave] === undefined) {
      process.env[chave] = valor;
    }
  }
}
