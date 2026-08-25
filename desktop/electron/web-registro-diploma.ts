/**
 * Cliente do serviço de verificação web — consulta pública de
 * DIPLOMA DIGITAL (POST /api/diplomas + GET /d/:codigo).
 * Mesmo padrão de web-registro.ts (x-api-key, timeout 30s p/ cold
 * start, retry em falha de rede/5xx — endpoint idempotente).
 *
 * Publica apenas os dados mínimos de consulta pública (LGPD):
 * código de validação oficial, nome do diplomado, curso, IES e data
 * do registro. Nada além disso.
 */
import { CONFIG } from './config';

const TIMEOUT_MS = 30_000;
const TENTATIVAS = 2;

export interface PayloadDiplomaPublico {
  codigo: string;
  alunoNome: string;
  curso: string | null;
  nomeIes: string;
  dataRegistro?: string;
  registradoPor?: string;
}

export async function registrarDiplomaPublicoWeb(p: PayloadDiplomaPublico): Promise<{ ok: boolean; error?: string }> {
  if (!p.codigo) return { ok: false, error: 'Código de validação ausente' };
  const url = `${CONFIG.VERIFICACAO_BASE_URL.replace(/\/+$/, '')}/api/diplomas`;
  const body = JSON.stringify({
    codigo: p.codigo,
    aluno_nome: p.alunoNome,
    curso: p.curso ?? null,
    ies: p.nomeIes,
    data_registro: p.dataRegistro ?? null,
    registrado_por: p.registradoPor ?? null,
  });

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
      if (resp.status < 500) return { ok: false, error: ultimoErro };
    } catch (e: any) {
      ultimoErro = e?.name === 'AbortError'
        ? `Timeout de ${TIMEOUT_MS / 1000}s ao contatar o serviço`
        : (e?.message ?? 'Falha ao contatar o serviço');
    } finally {
      clearTimeout(timeout);
    }
  }
  return { ok: false, error: ultimoErro };
}
