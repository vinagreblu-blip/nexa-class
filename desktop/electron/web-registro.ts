/**
 * Cliente do serviço de verificação web (POST/DELETE /api/declaracoes).
 * Compartilhado entre historico.ts e declaracao.ts.
 *
 * Timeout de 30s (não 8s): o free tier do Render adormece após 15 min sem
 * tráfego e o primeiro request após cold start pode levar ~30s.
 * Retry único em falha de rede ou 5xx — o endpoint é idempotente
 * (INSERT OR REPLACE no banco do serviço), reenviar é seguro.
 */
import { CONFIG } from './config';
import type { Aluno } from './types';

const TIMEOUT_MS = 30_000;
const TENTATIVAS = 2;

export interface ResultadoWeb {
  ok: boolean;
  error?: string;
}

export interface PayloadDeclaracao {
  codigo_verificacao: string;
  hash_conteudo: string;
  aluno: Aluno;
  emitidoEm: string;
}

function montarBody(p: PayloadDeclaracao): string {
  return JSON.stringify({
    codigo_verificacao: p.codigo_verificacao,
    hash_conteudo: p.hash_conteudo,
    dados_aluno: {
      nome: p.aluno.nome,
      matricula: p.aluno.matricula,
      curso: p.aluno.curso ?? null,
      cpf: p.aluno.cpf ?? null,
    },
    emitido_em: p.emitidoEm,
  });
}

export async function registrarDeclaracaoWeb(p: PayloadDeclaracao): Promise<ResultadoWeb> {
  const url = `${CONFIG.VERIFICACAO_BASE_URL.replace(/\/+$/, '')}/api/declaracoes`;
  const body = montarBody(p);

  let ultimoErro = '';
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': CONFIG.VERIFICACAO_API_KEY },
        body,
        signal: controller.signal,
      });
      if (resp.ok) return { ok: true };
      const texto = await resp.text().catch(() => '');
      ultimoErro = `Serviço web retornou ${resp.status}: ${texto}`;
      // 4xx é erro definitivo (payload/API key) — retry não ajuda.
      if (resp.status < 500) return { ok: false, error: ultimoErro };
    } catch (e: any) {
      ultimoErro = e?.name === 'AbortError'
        ? `Timeout de ${TIMEOUT_MS / 1000}s ao contatar o serviço de verificação`
        : (e?.message ?? 'Falha ao contatar o serviço de verificação');
    } finally {
      clearTimeout(timeout);
    }
  }
  return { ok: false, error: ultimoErro };
}

export async function removerDeclaracaoWeb(codigo: string): Promise<boolean> {
  const url = `${CONFIG.VERIFICACAO_BASE_URL.replace(/\/+$/, '')}/api/declaracoes/${encodeURIComponent(codigo)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'DELETE',
      headers: { 'x-api-key': CONFIG.VERIFICACAO_API_KEY },
      signal: controller.signal,
    });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
