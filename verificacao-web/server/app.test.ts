import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import request from 'supertest';
import { initDb, registrarDeclaracao, removerDeclaracao, buscarDeclaracao } from './db';
import { createApp } from './app';

const API_KEY = 'test-secret-key';
const INSTITUICAO = 'Faculdade de Testes';
const TMP_DB = path.join(os.tmpdir(), `nexa-apptest-${process.pid}-${Date.now()}.sqlite`);

beforeAll(async () => {
  process.env.DB_PATH = TMP_DB;
  await initDb();
});

afterAll(() => {
  try {
    if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
  } catch {
    /* ignora */
  }
});

beforeEach(() => {
  removerDeclaracao('cod-123');
  removerDeclaracao('cod-456');
  removerDeclaracao('cod-xss');
});

describe('GET /health', () => {
  it('retorna 200 + ok:true + instituicao', async () => {
    const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO }, null);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      servico: 'verificacao-web',
      instituicao: INSTITUICAO,
    });
  });
});

describe('POST /api/declaracoes', () => {
  const payloadValido = {
    codigo_verificacao: 'cod-123',
    hash_conteudo: 'hashabc',
    dados_aluno: {
      nome: 'João da Silva',
      matricula: '2024001',
      curso: 'Direito',
      cpf: '12345678900',
    },
    emitido_em: '2026-08-10T15:00:00.000Z',
  };

  it('retorna 401 sem x-api-key', async () => {
    const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO }, null);
    const res = await request(app).post('/api/declaracoes').send(payloadValido);
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('retorna 401 (não 500) com key de tamanho diferente — guard do timingSafeEqual', async () => {
    // Antes do guard, buffers de tamanho diferente fariam timingSafeEqual lançar RangeError
    // e virar 500, vazando o comprimento esperado da key.
    const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO }, null);
    const res = await request(app)
      .post('/api/declaracoes')
      .set('x-api-key', 'curta')
      .send(payloadValido);
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('retorna 401 com key errada mas de mesmo tamanho', async () => {
    const keyErrada = 'test-secret-XXX'; // mesmo len de 'test-secret-key'
    const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO }, null);
    const res = await request(app)
      .post('/api/declaracoes')
      .set('x-api-key', keyErrada)
      .send(payloadValido);
    expect(res.status).toBe(401);
  });

  it('retorna 201 com key certa + payload completo', async () => {
    const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO }, null);
    const res = await request(app)
      .post('/api/declaracoes')
      .set('x-api-key', API_KEY)
      .send(payloadValido);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
  });

  it('retorna 400 quando faltam campos obrigatórios do payload', async () => {
    const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO }, null);
    const res = await request(app)
      .post('/api/declaracoes')
      .set('x-api-key', API_KEY)
      .send({ codigo_verificacao: 'cod-123' }); // faltam hash_conteudo, dados_aluno, emitido_em
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('retorna 400 quando dados_aluno.nome ou matricula estão ausentes', async () => {
    const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO }, null);
    const res = await request(app)
      .post('/api/declaracoes')
      .set('x-api-key', API_KEY)
      .send({
        codigo_verificacao: 'cod-123',
        hash_conteudo: 'h',
        dados_aluno: { nome: '', matricula: '' },
        emitido_em: '2026-08-10T15:00:00.000Z',
      });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/declaracoes/:codigo', () => {
  it('retorna 200 + decl e dispara side-effect marcarVerificado no DB', async () => {
    // NOTA: o endpoint chama buscarDeclaracao (que captura verificado_em=null),
    // depois marcarVerificado, e responde com o objeto pré-marcação. Logo,
    // verificado_em no corpo da resposta é sempre null na 1a chamada — bug
    // menor documentado por este teste. O side-effect no DB é o que importa.
    registrarDeclaracao({
      codigo_verificacao: 'cod-456',
      hash_conteudo: 'h',
      dados_aluno: { nome: 'X', matricula: 'm', curso: null, cpf: null },
      emitido_em: '2026-08-10T15:00:00.000Z',
      verificado_em: null,
    });
    const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO }, null);
    const res = await request(app).get('/api/declaracoes/cod-456');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.codigo_verificacao).toBe('cod-456');
    // Side-effect: consultando direto o DB, verificado_em foi setado.
    const posDb = buscarDeclaracao('cod-456');
    expect(posDb!.verificado_em).not.toBeNull();
  });

  it('retorna 404 para código inexistente', async () => {
    const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO }, null);
    const res = await request(app).get('/api/declaracoes/nao-existe');
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/declaracoes/:codigo', () => {
  it('retorna 401 sem x-api-key', async () => {
    const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO }, null);
    const res = await request(app).delete('/api/declaracoes/cod-123');
    expect(res.status).toBe(401);
  });

  it('retorna 404 quando código não existe', async () => {
    const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO }, null);
    const res = await request(app)
      .delete('/api/declaracoes/nao-existe')
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(404);
  });

  it('retorna 200 quando remove existente', async () => {
    registrarDeclaracao({
      codigo_verificacao: 'cod-456',
      hash_conteudo: 'h',
      dados_aluno: { nome: 'X', matricula: 'm', curso: null, cpf: null },
      emitido_em: '2026-08-10T15:00:00.000Z',
      verificado_em: null,
    });
    const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO }, null);
    const res = await request(app)
      .delete('/api/declaracoes/cod-456')
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('GET /v/:codigo (página pública)', () => {
  it('renderiza página "Documento Autêntico" quando código existe', async () => {
    registrarDeclaracao({
      codigo_verificacao: 'cod-456',
      hash_conteudo: 'h',
      dados_aluno: { nome: 'João', matricula: 'm', curso: null, cpf: null },
      emitido_em: '2026-08-10T15:00:00.000Z',
      verificado_em: null,
    });
    const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO }, null);
    const res = await request(app).get('/v/cod-456');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Documento Autêntico');
    expect(res.text).toContain('João');
  });

  it('renderiza página "não encontrado" para código inexistente', async () => {
    const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO }, null);
    const res = await request(app).get('/v/nao-existe');
    expect(res.status).toBe(404);
    expect(res.text).toContain('não encontrado');
  });

  it('escapa HTML no nome do aluno (proteção XSS)', async () => {
    // Antes do escapeHtml, este payload executaria o script no navegador de
    // quem escaneasse o QR forjado.
    registrarDeclaracao({
      codigo_verificacao: 'cod-xss',
      hash_conteudo: 'h',
      dados_aluno: {
        nome: '<script>alert("xss")</script>',
        matricula: 'm',
        curso: null,
        cpf: null,
      },
      emitido_em: '2026-08-10T15:00:00.000Z',
      verificado_em: null,
    });
    const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO }, null);
    const res = await request(app).get('/v/cod-xss');
    expect(res.text).not.toContain('<script>alert');
    expect(res.text).toContain('&lt;script&gt;alert');
  });

  it('escapa HTML na instituição', async () => {
    const app = createApp(
      {
        apiKey: API_KEY,
        instituicao: '<img src=x onerror=alert(1)>',
      },
      null
    );
    const res = await request(app).get('/v/cod-456');
    expect(res.text).not.toContain('<img src=x onerror');
    expect(res.text).toContain('&lt;img');
  });
});

describe('Hardening — helmet (headers HTTP de segurança)', () => {
  it('adiciona X-Content-Type-Options: nosniff', async () => {
    const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO });
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('adiciona Content-Security-Policy permitindo style inline (necessário para /v/:codigo)', async () => {
    const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO });
    const res = await request(app).get('/health');
    const csp = res.headers['content-security-policy'] as string | undefined;
    expect(csp).toBeDefined();
    expect(csp).toContain("style-src");
    expect(csp).toContain("'unsafe-inline'");
  });

  it('CSP bloqueia scripts inline (script-src sem unsafe-inline)', async () => {
    const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO });
    const res = await request(app).get('/health');
    const csp = res.headers['content-security-policy'] as string;
    // script-src deve existir e NÃO permitir unsafe-inline.
    expect(csp).toMatch(/script-src[^;]*'self'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it('adiciona X-Frame-Options ou frame-ancestors (proteção clickjacking)', async () => {
    const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO });
    const res = await request(app).get('/health');
    const xfo = res.headers['x-frame-options'] as string | undefined;
    const csp = res.headers['content-security-policy'] as string | undefined;
    // Helmet moderno usa frame-ancestors via CSP; versões antigas usam X-Frame-Options.
    const temProtecao = xfo !== undefined || (csp && csp.includes('frame-ancestors'));
    expect(temProtecao).toBe(true);
  });

  it('não aplica headers quando rateLimitCfg === null', async () => {
    // Confirma que `null` desabilita tanto rate-limit quanto helmet (forma curta de testes).
    const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO }, null);
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBeUndefined();
  });
});

describe('Hardening — rate limit', () => {
  it('retorna 429 após exceder o limite configurado', async () => {
    const app = createApp(
      { apiKey: API_KEY, instituicao: INSTITUICAO },
      { habilitado: true, max: 2, janelaMs: 60_000 }
    );

    // 2 primeiras requisições a /api/declaracoes/:codigo passam (retornam 404,
    // não 429 — limite ainda não estourou).
    const r1 = await request(app).get('/api/declaracoes/inexistente-1');
    const r2 = await request(app).get('/api/declaracoes/inexistente-2');
    expect(r1.status).toBe(404);
    expect(r2.status).toBe(404);

    // 3a deve ser throttled.
    const r3 = await request(app).get('/api/declaracoes/inexistente-3');
    expect(r3.status).toBe(429);
    expect(r3.body.ok).toBe(false);
    expect(r3.body.error).toMatch(/Muitas requisições/i);
  });

  it('/health NÃO conta para o rate-limit', async () => {
    // Health checks de infra podem vir em rajadas (Docker, k8s, monitoring).
    const app = createApp(
      { apiKey: API_KEY, instituicao: INSTITUICAO },
      { habilitado: true, max: 2, janelaMs: 60_000 }
    );

    // Mesmo após 5 health checks, nenhum é bloqueado.
    for (let i = 0; i < 5; i++) {
      const r = await request(app).get('/health');
      expect(r.status).toBe(200);
    }
  });

  it('expõe headers padrão RateLimit-* (standardHeaders)', async () => {
    const app = createApp(
      { apiKey: API_KEY, instituicao: INSTITUICAO },
      { habilitado: true, max: 5, janelaMs: 60_000 }
    );
    const res = await request(app).get('/api/declaracoes/x');
    expect(res.headers['ratelimit-limit']).toBeDefined();
    expect(res.headers['ratelimit-remaining']).toBeDefined();
    expect(res.headers['ratelimit-reset']).toBeDefined();
  });

  it('não expõe headers legacy X-RateLimit-*', async () => {
    const app = createApp(
      { apiKey: API_KEY, instituicao: INSTITUICAO },
      { habilitado: true, max: 5, janelaMs: 60_000 }
    );
    const res = await request(app).get('/api/declaracoes/x');
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
    expect(res.headers['x-ratelimit-remaining']).toBeUndefined();
  });

  it('respeita habilitado: false no config', async () => {
    // Mesmo passando config, se habilitado=false, não aplica rate-limit.
    const app = createApp(
      { apiKey: API_KEY, instituicao: INSTITUICAO },
      { habilitado: false, max: 1, janelaMs: 60_000 }
    );
    // 10 requests, nenhuma deve ser 429.
    for (let i = 0; i < 10; i++) {
      const r = await request(app).get('/api/declaracoes/x');
      expect(r.status).not.toBe(429);
    }
  });

  it('usa defaults quando config não especifica limites', async () => {
    const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO });
    // Default deve permitir pelo menos 50 requests (default real é 100).
    for (let i = 0; i < 50; i++) {
      const r = await request(app).get('/api/declaracoes/x');
      expect(r.status).not.toBe(429);
    }
  });
});
