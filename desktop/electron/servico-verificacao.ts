import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './database';
import { CONFIG } from './config';
import { getLocalIP } from './network';

const API_KEY = CONFIG.VERIFICACAO_API_KEY;
const PORT = 3001;
const LOCAL_IP = getLocalIP();

// Carrega a página de validação (QR com dados embutidos)
let validadorHtml = '';
try {
  const validadorPath = path.join(__dirname, '..', 'resources', 'validador.html');
  if (fs.existsSync(validadorPath)) {
    validadorHtml = fs.readFileSync(validadorPath, 'utf8');
  }
} catch { /* ignora */ }

interface DeclaracaoRow {
  codigo_verificacao: string;
  hash_conteudo: string;
  dados_aluno_json: string;
  emitido_em: string;
}

let serverInstance: http.Server | null = null;

export function iniciarServicoVerificacao(): http.Server | null {
  if (serverInstance) return serverInstance;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // === Health check ===
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, servico: 'verificacao-nexa', ip: LOCAL_IP }));
      return;
    }

    // === Página de validação (QR com dados embutidos) ===
    if (req.method === 'GET' && (url.pathname === '/validador.html' || url.pathname === '/validador')) {
      if (validadorHtml) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(validadorHtml);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>Validador não encontrado</h1>');
      }
      return;
    }

    // === Raiz ===
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h1>NEXA CLASS — Serviço de Verificação</h1>
        <p>Servidor ativo em ${LOCAL_IP}:${PORT}</p>
        <p>Escaneie um QR Code de um documento para validar.</p>
      </body></html>`);
      return;
    }

    // === POST /api/declaracoes (registra declaração para validação) ===
    if (req.method === 'POST' && url.pathname === '/api/declaracoes') {
      const apiKey = req.headers['x-api-key'];
      if (apiKey !== API_KEY) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'API key inválida' }));
        return;
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.codigo_verificacao || !data.hash_conteudo) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Dados incompletos' }));
            return;
          }
          // Salva no banco do app (tabela declaracoes já tem os dados, mas salvamos para validação web)
          const db = getDb();
          db.prepare(
            `INSERT OR REPLACE INTO declaracoes_web (codigo_verificacao, hash_conteudo, dados_aluno_json, emitido_em)
             VALUES (?, ?, ?, ?)`
          ).run(
            data.codigo_verificacao,
            data.hash_conteudo,
            JSON.stringify(data.dados_aluno || {}),
            data.emitido_em || new Date().toISOString()
          );
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e?.message }));
        }
      });
      return;
    }

    // === GET /v/:codigo (página pública de verificação) ===
    if (req.method === 'GET' && url.pathname.startsWith('/v/')) {
      const codigo = decodeURIComponent(url.pathname.replace('/v/', ''));
      const db = getDb();

      // Procura na tabela declaracoes_web
      let row: DeclaracaoRow | null = null;
      try {
        const r = db
          .prepare('SELECT * FROM declaracoes_web WHERE codigo_verificacao = ?')
          .get(codigo) as DeclaracaoRow | undefined;
        row = r ?? null;
      } catch {
        // Tabela pode não existir ainda
      }

      // Fallback: procura na tabela declaracoes (com JOIN)
      if (!row) {
        try {
          const r = db
            .prepare(
              `SELECT d.codigo_verificacao, d.hash_conteudo, d.emitido_em,
                      a.nome as aluno_nome, a.matricula as aluno_matricula, a.curso as aluno_curso
               FROM declaracoes d
               JOIN alunos a ON a.id = d.aluno_id
               WHERE d.codigo_verificacao = ?`
            )
            .get(codigo) as any;
          if (r) {
            row = {
              codigo_verificacao: r.codigo_verificacao,
              hash_conteudo: r.hash_conteudo,
              dados_aluno_json: JSON.stringify({
                nome: r.aluno_nome,
                matricula: r.aluno_matricula,
                curso: r.aluno_curso,
              }),
              emitido_em: r.emitido_em,
            };
          }
        } catch { /* ignora */ }
      }

      const html = row ? paginaValido(row) : paginaInvalido(codigo);
      res.writeHead(row ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // === DELETE /api/declaracoes/:codigo ===
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/declaracoes/')) {
      const apiKey = req.headers['x-api-key'];
      if (apiKey !== API_KEY) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'API key inválida' }));
        return;
      }
      const codigo = decodeURIComponent(url.pathname.replace('/api/declaracoes/', ''));
      try {
        const db = getDb();
        db.prepare('DELETE FROM declaracoes_web WHERE codigo_verificacao = ?').run(codigo);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e?.message }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404 - Não encontrado</h1>');
  });

  server.on('error', (e: any) => {
    if (e?.code === 'EADDRINUSE') {
      console.warn(`[verificacao] Porta ${PORT} já em uso — serviço externo provavelmente ativo`);
    } else {
      console.error('[verificacao] Erro:', e?.message);
    }
  });

  server.listen(PORT, () => {
    console.log(`[verificacao] Serviço de validação ativo em http://localhost:${PORT}`);
  });

  serverInstance = server;
  return server;
}

function escapeHtml(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function paginaValido(row: DeclaracaoRow): string {
  let aluno: { nome?: string; matricula?: string; curso?: string } = {};
  try { aluno = JSON.parse(row.dados_aluno_json); } catch { /* ignora */ }
  const data = new Date(row.emitido_em).toLocaleString('pt-BR', { timeZone: 'UTC' });

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Documento Autêntico — NEXA CLASS</title>
    <style>
      *{box-sizing:border-box}
      body{margin:0;font-family:'Segoe UI',system-ui,sans-serif;background:linear-gradient(135deg,#1f4e5f,#071d25);
        min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
      .card{background:#fff;border-radius:16px;padding:36px;max-width:480px;width:100%;
        box-shadow:0 20px 50px rgba(0,0,0,.3)}
      .icon{width:72px;height:72px;border-radius:50%;background:#16a34a;margin:0 auto 16px;
        display:flex;align-items:center;justify-content:center;font-size:36px;color:#fff}
      h1{text-align:center;color:#1f4e5f;font-size:22px;margin:0 0 6px}
      .sub{text-align:center;color:#666;font-size:13px;margin:0 0 20px}
      table{width:100%;border-collapse:collapse;margin:8px 0}
      th{text-align:left;padding:10px;background:#f8fafc;font-size:12px;color:#64748b;
        text-transform:uppercase;border-bottom:2px solid #e2e8f0}
      td{padding:10px;border-bottom:1px solid #e2e8f0;font-weight:500}
      .hash{font-size:11px;color:#999;font-family:monospace;word-break:break-all;margin-top:12px}
      .footer{text-align:center;margin-top:16px;padding-top:16px;border-top:1px solid #e2e8f0;
        font-size:12px;color:#999}
    </style></head><body>
    <div class="card">
      <div class="icon">✓</div>
      <h1>Documento Autêntico</h1>
      <p class="sub">A autenticidade deste documento foi confirmada pelo sistema NEXA CLASS.</p>
      <table>
        <tr><th>Aluno</th><td>${escapeHtml(aluno.nome || '—')}</td></tr>
        <tr><th>Matrícula</th><td>${escapeHtml(aluno.matricula || '—')}</td></tr>
        ${aluno.curso ? `<tr><th>Curso</th><td>${escapeHtml(aluno.curso)}</td></tr>` : ''}
        <tr><th>Emitido em</th><td>${escapeHtml(data)}</td></tr>
      </table>
      <div class="hash">Código: ${escapeHtml(row.codigo_verificacao.substring(0, 20))}…</div>
      <div class="footer">Validado pelo sistema NEXA CLASS</div>
    </div></body></html>`;
}

function paginaInvalido(_codigo: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Documento não encontrado — NEXA CLASS</title>
    <style>
      body{margin:0;font-family:'Segoe UI',system-ui,sans-serif;background:linear-gradient(135deg,#1f4e5f,#071d25);
        min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
      .card{background:#fff;border-radius:16px;padding:36px;max-width:420px;text-align:center}
      .icon{width:64px;height:64px;border-radius:50%;background:#dc2626;margin:0 auto 16px;
        display:flex;align-items:center;justify-content:center;font-size:30px;color:#fff}
      h1{color:#dc2626;font-size:20px;margin:0 0 8px}
      p{color:#666;font-size:14px}
    </style></head><body>
    <div class="card">
      <div class="icon">✕</div>
      <h1>Documento Não Encontrado</h1>
      <p>O código informado não corresponde a nenhum documento válido emitido pelo sistema NEXA CLASS.</p>
      <p style="font-size:12px;color:#999;margin-top:16px">Verifique se o QR Code foi escaneado completamente ou se o aplicativo NEXA CLASS está em execução.</p>
    </div></body></html>`;
}
