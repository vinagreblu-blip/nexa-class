"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.iniciarResetServer = iniciarResetServer;
const node_http_1 = __importDefault(require("node:http"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const database_1 = require("./database");
const config_1 = require("./config");
function iniciarResetServer() {
    const server = node_http_1.default.createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost:${config_1.CONFIG.RESET_SERVER_PORT}`);
        if (req.method === 'GET' && url.pathname === '/redefinir-senha') {
            const token = url.searchParams.get('token');
            if (!token) {
                res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(paginaErro('Token ausente.'));
                return;
            }
            // verifica token
            const db = (0, database_1.getDb)();
            const row = db
                .prepare('SELECT id, reset_expires FROM usuarios WHERE reset_token = ?')
                .get(token);
            if (!row || !row.reset_expires || new Date(row.reset_expires) < new Date()) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(paginaErro('Link expirado ou inválido. Solicite uma nova recuperação de senha.'));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(paginaForm(token));
            return;
        }
        if (req.method === 'POST' && url.pathname === '/api/redefinir') {
            let body = '';
            req.on('data', (c) => (body += c));
            req.on('end', () => {
                try {
                    const { token, novaSenha } = JSON.parse(body);
                    if (!token || !novaSenha || novaSenha.length < 6) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: 'Senha inválida (mínimo 6 caracteres)' }));
                        return;
                    }
                    const db = (0, database_1.getDb)();
                    const row = db
                        .prepare('SELECT id, reset_expires FROM usuarios WHERE reset_token = ?')
                        .get(token);
                    if (!row || !row.reset_expires || new Date(row.reset_expires) < new Date()) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: 'Link expirado ou inválido' }));
                        return;
                    }
                    const hash = bcryptjs_1.default.hashSync(novaSenha, 10);
                    db.prepare(`UPDATE usuarios SET password_hash = ?, reset_token = NULL, reset_expires = NULL, updated_at = datetime('now') WHERE id = ?`).run(hash, row.id);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true }));
                }
                catch {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'Erro interno' }));
                }
            });
            return;
        }
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('Não encontrado');
    });
    server.on('error', (e) => {
        if (e?.code === 'EADDRINUSE') {
            console.warn(`[reset-server] Porta ${config_1.CONFIG.RESET_SERVER_PORT} em uso — servidor de redefinição não iniciado`);
        }
        else {
            console.error('[reset-server] Erro:', e?.message ?? e);
        }
    });
    server.listen(config_1.CONFIG.RESET_SERVER_PORT, () => {
        console.log(`[reset-server] Servidor de redefinição em http://localhost:${config_1.CONFIG.RESET_SERVER_PORT}`);
    });
    return server;
}
function paginaForm(token) {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Redefinir Senha — NEXA CLASS</title>
    <style>
      *{box-sizing:border-box}body{margin:0;font-family:'Segoe UI',system-ui,sans-serif;
      background:#1f4e5f;display:flex;min-height:100vh;align-items:center;justify-content:center}
      .card{background:#fff;border-radius:14px;padding:36px;max-width:420px;width:90%;box-shadow:0 10px 30px rgba(0,0,0,.2)}
      h1{color:#1f4e5f;font-size:22px;margin:0 0 6px}p.sub{color:#666;font-size:13px;margin:0 0 24px}
      label{display:block;font-size:12px;font-weight:600;color:#666;text-transform:uppercase;margin-bottom:4px}
      input{width:100%;padding:10px 14px;border:1px solid #ddd;border-radius:8px;font-size:15px;margin-bottom:16px}
      input:focus{outline:2px solid #1f4e5f;border-color:#1f4e5f}
      button{width:100%;padding:12px;background:#1f4e5f;color:#fff;border:none;border-radius:8px;font-size:16px;cursor:pointer}
      button:hover{background:#163d4a}.msg{margin-top:16px;padding:12px;border-radius:8px;font-size:14px;display:none}
      .ok{background:#d4edda;color:#155724}.err{background:#f8d7da;color:#721c24}
    </style></head><body>
    <div class="card"><h1>Redefinir Senha</h1>
    <p class="sub">NEXA CLASS — Network for Education and Academic Excellence Class</p>
    <form id="f">
      <label>Nova Senha (mín. 6 caracteres)</label>
      <input type="password" id="senha" placeholder="•••••••" required minlength="6">
      <label>Confirmar Nova Senha</label>
      <input type="password" id="confirma" placeholder="•••••••" required minlength="6">
      <button type="submit">Redefinir Senha</button>
    </form>
    <div class="msg" id="msg"></div></div>
    <script>
      document.getElementById('f').addEventListener('submit', async (e) => {
        e.preventDefault();
        const s = document.getElementById('senha').value;
        const c = document.getElementById('confirma').value;
        const msg = document.getElementById('msg');
        if (s !== c) { msg.className='msg err'; msg.textContent='As senhas não conferem.'; msg.style.display='block'; return; }
        try {
          const r = await fetch('/api/redefinir', {method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({token:'${token}',novaSenha:s})});
          const d = await r.json();
          if (d.ok) { msg.className='msg ok'; msg.innerHTML='✅ Senha redefinida com sucesso! Você já pode fechar esta página e fazer login no sistema.'; msg.style.display='block';
            document.getElementById('f').style.display='none'; }
          else { msg.className='msg err'; msg.textContent=d.error||'Erro'; msg.style.display='block'; }
        } catch(ex) { msg.className='msg err'; msg.textContent='Erro de conexão'; msg.style.display='block'; }
      });
    </script></body></html>`;
}
function paginaErro(msg) {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Erro — NEXA CLASS</title>
    <style>body{margin:0;font-family:'Segoe UI',system-ui,sans-serif;background:#1f4e5f;
    display:flex;min-height:100vh;align-items:center;justify-content:center}
    .card{background:#fff;border-radius:14px;padding:36px;max-width:420px;text-align:center}
    h1{color:#dc2626;font-size:20px}p{color:#666;font-size:14px}</style></head>
    <body><div class="card"><h1>⚠️ Erro</h1><p>${msg}</p></div></body></html>`;
}
//# sourceMappingURL=reset-server.js.map