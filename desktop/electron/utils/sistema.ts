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

/**
 * Sanitiza texto (nome de aluno, etc.) para uso seguro em nomes de arquivo.
 *
 * Regras:
 *  - Lowercase
 *  - Remove acentos (NFD + strip non-ASCII)
 *  - Espaços → hifens
 *  - Remove chars não [a-z0-9-]
 *  - Colapsa hifens consecutivos
 *  - Trunca em maxLen (default 40)
 *  - Remove hifens das bordas
 *
 * Ex.: "João da Silva SANTOS" → "joao-da-silva-santos"
 *      "Ana Beatriz" → "ana-beatriz"
 *      ""            → "aluno"  (fallback)
 *      "José R.  "   → "jose-r"
 */
export function sanitizarParaArquivo(texto: string | null | undefined, maxLen = 40): string {
  const fallback = 'aluno';
  if (!texto) return fallback;
  const semAcentos = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacríticos
    .toLowerCase()
    .trim();
  if (!semAcentos) return fallback;
  const sanitizado = semAcentos
    .replace(/[^a-z0-9\s-]/g, '') // remove especiais exceto espaço e hífen
    .replace(/\s+/g, '-')         // espaços → hífen
    .replace(/-+/g, '-')          // colapsa hifens
    .substring(0, maxLen)
    .replace(/^-+|-+$/g, '');     // remove hifens das bordas
  return sanitizado || fallback;
}

/**
 * Monta nome de arquivo PDF padronizado:
 * `{prefixo}-{nome-aluno}-{matricula}-{sufixo}.pdf`
 *
 * Ex.: montarNomePdf('diploma', 'João da Silva', '2024001', 5)
 *    → "diploma-joao-da-silva-2024001-5.pdf"
 */
export function montarNomePdf(
  prefixo: string,
  nomeAluno: string | null | undefined,
  matricula: string | null | undefined,
  sufixo: string | number
): string {
  const nome = sanitizarParaArquivo(nomeAluno);
  const mat = sanitizarParaArquivo(matricula, 20);
  return `${prefixo}-${nome}-${mat}-${sufixo}.pdf`;
}

/**
 * Mesmo que montarNomePdf mas com extensão customizável (XML, etc.).
 */
export function montarNomeArquivo(
  prefixo: string,
  nomeAluno: string | null | undefined,
  matricula: string | null | undefined,
  sufixo: string | number,
  extensao: string
): string {
  const nome = sanitizarParaArquivo(nomeAluno);
  const mat = sanitizarParaArquivo(matricula, 20);
  return `${prefixo}-${nome}-${mat}-${sufixo}.${extensao.replace(/^\./, '')}`;
}

/**
 * Grava arquivo de texto (utf8) no destino; se a pasta for bloqueada
 * (permissão, OneDrive, "Acesso Controlado a Pastas" do Defender, caminho
 * longo, etc.), salva na pasta de fallback e reporta.
 */
export function gravarArquivoSeguro(
  destinoPath: string,
  conteudo: string,
  fallbackDir: string,
  nomeFallback?: string
): { ok: true; caminho: string; usouFallback: boolean } | { ok: false; erro: string } {
  try {
    fs.writeFileSync(destinoPath, conteudo, 'utf8');
    return { ok: true, caminho: destinoPath, usouFallback: false };
  } catch (erroDestino: any) {
    const detalheDestino = erroDestino?.code ? `${erroDestino.code}: ${erroDestino.message}` : String(erroDestino?.message ?? erroDestino);
    try {
      fs.mkdirSync(fallbackDir, { recursive: true });
      const fallbackPath = path.join(fallbackDir, nomeFallback ?? path.basename(destinoPath));
      fs.writeFileSync(fallbackPath, conteudo, 'utf8');
      return { ok: true, caminho: fallbackPath, usouFallback: true };
    } catch (erroFallback: any) {
      const detalheFallback = String(erroFallback?.message ?? erroFallback);
      return {
        ok: false,
        erro: `Falha ao gravar em "${destinoPath}" (${detalheDestino}) e também em "${fallbackDir}" (${detalheFallback}). Verifique permissões da pasta, OneDrive ou antivírus.`,
      };
    }
  }
}
