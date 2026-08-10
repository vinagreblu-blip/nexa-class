import fs from 'node:fs';
import path from 'node:path';

/**
 * Helpers de filesystem puras (sem dependência de electron/DB).
 * Separadas de ipc/dashboard.ts para permitir testes sem subir Electron runtime.
 */

/** Calcula o tamanho (em bytes) de um diretório recursivamente. */
export function calcularTamanhoDiretorio(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  const visitar = (p: string) => {
    const stat = fs.statSync(p);
    if (stat.isFile()) {
      total += stat.size;
    } else if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(p)) visitar(path.join(p, entry));
    }
  };
  try {
    visitar(dirPath);
  } catch {
    /* ignora — não é crítico */
  }
  return total;
}
