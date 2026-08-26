// ============================================================
// COMPARTILHAMENTO DE PDFS ASSINADOS ENTRE MÁQUINAS
// ============================================================
// O certificado A3 (token USB) fica em UMA máquina só — quem assina é ela.
// O PDF assinado, porém, precisa ser acessível aos outros usuários.
// Este módulo:
//   - compartilharPdf(): envia o PDF assinado (base64) para a tabela
//     `arquivos_pdf` do Supabase logo após a emissão (fire-and-forget,
//     com 1 retry — nunca bloqueia nem falha a emissão);
//   - garantirPdfLocal(): no "Baixar", se o arquivo não existir nesta
//     máquina (foi emitido em outra), baixa da nuvem para o cache local.
//
// Segurança: acesso via RLS `authenticated` (mesma política das demais
// tabelas). A tabela `arquivos` antiga segue bloqueada (guardava chaves
// privadas) — esta é nova e específica de PDFs públicos da instituição.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getClient } from './cloud';
import { logger } from './utils/logger';

/** Tabelas cujos PDFs podem ser compartilhados (whitelist — bate no CHECK do SQL). */
export const TABELAS_PDF = new Set(['declaracoes', 'diplomas', 'historicos', 'certificados', 'atas_colacao']);

/** Limite de tamanho para upload (15MB — PDFs assinados ficam bem abaixo). */
const TAMANHO_MAX_BYTES = 15 * 1024 * 1024;

export interface CompartilharPdfOpts {
  /** Retry automático único após 60s em caso de falha (offline no momento). */
  retry?: boolean;
}

/**
 * Envia o PDF assinado para a nuvem (fire-and-forget). Erros são apenas
 * logados — nunca devem falhar a emissão do documento.
 */
export async function compartilharPdf(
  tabela: string,
  registroId: number,
  pdfPath: string,
  opts: CompartilharPdfOpts = {}
): Promise<void> {
  if (!TABELAS_PDF.has(tabela)) return;
  const client = getClient();
  if (!client) return; // offline/nuvem desativada — retry cobre na próxima emissão
  try {
    if (!fs.existsSync(pdfPath)) return;
    const buf = fs.readFileSync(pdfPath);
    if (buf.length === 0) return;
    if (buf.length > TAMANHO_MAX_BYTES) {
      logger.warn({ tabela, registroId, bytes: buf.length }, 'PDF grande demais para compartilhar (limite 15MB)');
      return;
    }
    const { error } = await client.from('arquivos_pdf').upsert({
      tabela,
      registro_id: registroId,
      nome_arquivo: path.basename(pdfPath),
      dados: buf.toString('base64'),
      bytes: buf.length,
      host_origem: os.hostname(),
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    logger.info({ tabela, registroId, bytes: buf.length }, 'PDF assinado compartilhado na nuvem');
  } catch (e: any) {
    logger.warn({ err: e, tabela, registroId }, 'Falha ao compartilhar PDF na nuvem');
    if (opts.retry !== false) {
      setTimeout(() => {
        compartilharPdf(tabela, registroId, pdfPath, { retry: false }).catch(() => { /* já logado */ });
      }, 60_000);
    }
  }
}

/** Wrapper síncrono para chamar em fire-and-forget nos handlers de emissão. */
export function agendarCompartilharPdf(tabela: string, registroId: number, pdfPath: string): void {
  void compartilharPdf(tabela, registroId, pdfPath).catch(() => { /* já logado */ });
}

/**
 * Garante que o PDF exista localmente: se `destinoLocal` não existir, tenta
 * baixar da nuvem (emitido em outra máquina) e gravar em `destinoLocal`.
 * Retorna true se o arquivo existir ao final (local ou recém-baixado).
 */
export async function garantirPdfLocal(tabela: string, registroId: number, destinoLocal: string): Promise<boolean> {
  if (fs.existsSync(destinoLocal)) return true;
  const client = getClient();
  if (!client) return false;
  try {
    const { data, error } = await client
      .from('arquivos_pdf')
      .select('dados')
      .eq('tabela', tabela)
      .eq('registro_id', registroId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.dados) return false;
    const buf = Buffer.from(String(data.dados), 'base64');
    if (buf.length === 0) return false;
    fs.mkdirSync(path.dirname(destinoLocal), { recursive: true });
    fs.writeFileSync(destinoLocal, buf);
    logger.info({ tabela, registroId, bytes: buf.length }, 'PDF baixado da nuvem para cache local');
    return true;
  } catch (e: any) {
    logger.warn({ err: e, tabela, registroId }, 'Falha ao baixar PDF da nuvem');
    return false;
  }
}

/**
 * Verifica se o registro tem arquivo na nuvem (sem baixar). Usado pelo
 * backfill do boot: `existeNaNuvem === false` + arquivo local existente
 * => reenviar.
 */
export async function existeArquivoNaNuvem(tabela: string, registroId: number): Promise<boolean | null> {
  const client = getClient();
  if (!client) return null; // nuvem indisponível/desativada — não decide
  try {
    const { data, error } = await client
      .from('arquivos_pdf')
      .select('registro_id')
      .eq('tabela', tabela)
      .eq('registro_id', registroId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return !!data;
  } catch (e: any) {
    logger.warn({ err: e, tabela, registroId }, 'Falha ao checar arquivo na nuvem (backfill)');
    return null;
  }
}
