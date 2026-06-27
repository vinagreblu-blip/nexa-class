import express from 'express';
import crypto from 'node:crypto';
import { carregarEnv } from './env';
import { initDb, registrarDeclaracao, buscarDeclaracao, marcarVerificado, removerDeclaracao, type DeclaracaoRegistrada } from './db';

carregarEnv();

const PORT = Number(process.env.PORT ?? 3001);
const API_KEY = process.env.API_KEY ?? 'nexa-dev-api-key-trocar';
const INSTITUICAO = process.env.INSTITUICAO ?? 'NEXA CLASS - Network for Education and Academic Excellence Class';

const app = express();
app.use(express.json({ limit: '64kb' }));

function validarApiKey(req: express.Request, res: express.Response): boolean {
  const key = req.header('x-api-key');
  if (!key || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(API_KEY))) {
    res.status(401).json({ ok: false, error: 'API key inválida ou ausente' });
    return false;
  }
  return true;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, servico: 'verificacao-web', instituicao: INSTITUICAO });
});

app.post('/api/declaracoes', (req, res) => {
  if (!validarApiKey(req, res)) return;

  const body = req.body as Partial<DeclaracaoRegistrada>;
  if (!body?.codigo_verificacao || !body?.hash_conteudo || !body?.dados_aluno || !body?.emitido_em) {
    res.status(400).json({ ok: false, error: 'Payload inválido' });
    return;
  }
  if (!body.dados_aluno.nome || !body.dados_aluno.matricula) {
    res.status(400).json({ ok: false, error: 'dados_aluno.nome e dados_aluno.matricula são obrigatórios' });
    return;
  }

  registrarDeclaracao({
    codigo_verificacao: body.codigo_verificacao,
    hash_conteudo: body.hash_conteudo,
    dados_aluno: {
      nome: body.dados_aluno.nome,
      matricula: body.dados_aluno.matricula,
      curso: body.dados_aluno.curso ?? null,
      cpf: body.dados_aluno.cpf ?? null,
    },
    emitido_em: body.emitido_em,
    verificado_em: null,
  });

  res.status(201).json({ ok: true });
});

app.get('/api/declaracoes/:codigo', (req, res) => {
  const decl = buscarDeclaracao(req.params.codigo);
  if (!decl) {
    res.status(404).json({ ok: false, error: 'Documento não encontrado' });
    return;
  }
  marcarVerificado(decl.codigo_verificacao);
  res.json({ ok: true, data: decl });
});

app.delete('/api/declaracoes/:codigo', (req, res) => {
  if (!validarApiKey(req, res)) return;
  const result = removerDeclaracao(req.params.codigo);
  if (result.changes === 0) {
    res.status(404).json({ ok: false, error: 'Declaração não encontrada no serviço de verificação' });
    return;
  }
  res.json({ ok: true });
});

app.get('/v/:codigo', (req, res) => {
  const decl = buscarDeclaracao(req.params.codigo);
  res
    .status(decl ? 200 : 404)
    .set('Content-Type', 'text/html; charset=utf-8')
    .send(renderPagina(decl));
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPagina(decl: DeclaracaoRegistrada | null): string {
  const dataEmissao = decl
    ? new Date(decl.emitido_em).toLocaleString('pt-BR', { timeZone: 'UTC' })
    : '';
  const dataVerif = decl?.verificado_em
    ? new Date(decl.verificado_em).toLocaleString('pt-BR')
    : '';

  if (!decl) {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Documento não encontrado - ${escapeHtml(INSTITUICAO)}</title>
      <style>${estilos()}</style></head>
      <body><div class="card"><div class="icon error">✕</div>
      <h1>Documento não encontrado</h1>
      <p>O código informado não corresponde a nenhuma declaração válida emitida por ${escapeHtml(INSTITUICAO)}.</p>
      <p class="muted">Verifique se o QR Code foi escaneado por completo.</p>
      </div></body></html>`;
  }

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Documento autêntico - ${escapeHtml(INSTITUICAO)}</title>
    <style>${estilos()}</style></head>
    <body><div class="card">
      <div class="inst">${escapeHtml(INSTITUICAO)}</div>
      <div class="icon ok">✓</div>
      <h1>Documento Autêntico</h1>
      <p class="subtitle">A autenticidade desta declaração foi confirmada.</p>
      <table>
        <tr><th>Aluno</th><td>${escapeHtml(decl.dados_aluno.nome)}</td></tr>
        <tr><th>Matrícula</th><td>${escapeHtml(decl.dados_aluno.matricula)}</td></tr>
        ${decl.dados_aluno.curso ? `<tr><th>Curso</th><td>${escapeHtml(decl.dados_aluno.curso)}</td></tr>` : ''}
        <tr><th>Emitido em</th><td>${escapeHtml(dataEmissao)}</td></tr>
      </table>
      <div class="hash"><strong>Código:</strong> <code>${escapeHtml(decl.codigo_verificacao)}</code></div>
      <div class="hash"><strong>Hash:</strong> <code>${escapeHtml(decl.hash_conteudo)}</code></div>
      ${dataVerif ? `<p class="muted">Verificado em ${escapeHtml(dataVerif)}.</p>` : ''}
    </div></body></html>`;
}

function estilos(): string {
  return `
    *{box-sizing:border-box}
    body{margin:0;font-family:'Segoe UI',system-ui,sans-serif;background:#f0f4f8;color:#1e293b;
      display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px}
    .card{background:#fff;border-radius:14px;padding:34px;max-width:480px;width:100%;
      box-shadow:0 10px 30px rgba(0,0,0,.08);text-align:center}
    .inst{font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px}
    .icon{width:72px;height:72px;border-radius:50%;margin:0 auto 16px;display:flex;
      align-items:center;justify-content:center;font-size:36px;color:#fff}
    .icon.ok{background:#16a34a}.icon.error{background:#dc2626}
    h1{margin:0 0 8px;font-size:24px}
    .subtitle{color:#475569;margin:0 0 22px}
    .muted{color:#94a3b8;font-size:13px;margin:14px 0 0}
    table{width:100%;border-collapse:collapse;margin:8px 0 18px;text-align:left}
    th{padding:8px 10px;background:#f8fafc;font-size:12px;color:#64748b;text-transform:uppercase;
      letter-spacing:.04em;border-bottom:1px solid #e2e8f0;width:40%}
    td{padding:8px 10px;border-bottom:1px solid #e2e8f0;font-weight:500}
    .hash{font-size:11px;color:#64748b;text-align:left;margin:4px 0;word-break:break-all}
    code{font-family:monospace;color:#0b1f3a}
  `;
}

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`[verificacao-web] Serviço de verificação rodando em http://localhost:${PORT}`);
    console.log(`[verificacao-web] Instituição: ${INSTITUICAO}`);
  });
});
