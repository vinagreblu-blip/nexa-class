import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  limparCacheBry,
  obterTokenBry,
  testarConexaoBry,
  upgradeCarimboBry,
  URL_AUTH_BRY_PADRAO,
  URL_HUB_BRY_PRODUCAO,
  type ConfigBryHub,
} from './bry-hub-cliente';

// ============================================================
// Cliente BRy HUB — token OAuth2 (com cache) + upgrade TIMESTAMP.
// Sem rede: fetch global mockado por teste (vi.stubGlobal).
// Endpoints validados em 04/09/2026 contra os ambientes oficiais:
//   POST cloud.bry.com.br/token-service/jwt → {access_token, expires_in}
//   POST {hub}/xml/v1/upgrade/signature → [{status:200, document: base64}]
//   GET  {hub}/infos → {version, rateLimit}
// ============================================================

const CFG: ConfigBryHub = {
  urlAuth: URL_AUTH_BRY_PADRAO,
  clientId: 'app-teste',
  clientSecret: 'secret-teste',
  urlHub: URL_HUB_BRY_PRODUCAO,
};

function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  limparCacheBry();
});

describe('obterTokenBry (POST token-service/jwt)', () => {
  it('troca client_id/secret por JWT e guarda no cache', async () => {
    const chamadas: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push(String(url));
        void init;
        return respostaJson({ access_token: 'AAA.BBB.CCC', expires_in: 14400 });
      })
    );
    const t1 = await obterTokenBry(CFG);
    const t2 = await obterTokenBry(CFG); // cache — não refaz POST
    expect(t1).toBe('AAA.BBB.CCC');
    expect(t2).toBe(t1);
    expect(chamadas).toHaveLength(1);
    // corpo OAuth2 padrão
    const init = (fetch as any).mock.calls[0][1] as RequestInit;
    expect(String(init.body)).toContain('grant_type=client_credentials');
    expect(String(init.body)).toContain('client_id=app-teste');
  });

  it('401 → mensagem orienta conferir o secret (o reemitido invalida o anterior)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respostaJson({ status_code: 401, message: 'unauthorized' }, 401))
    );
    await expect(obterTokenBry(CFG)).rejects.toThrow(/401.*Client ID\/Client Secret/i);
  });

  it('campos obrigatórios validados antes da rede', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(obterTokenBry({ ...CFG, clientId: '' })).rejects.toThrow(/Client ID/i);
  });
});

describe('testarConexaoBry (GET /infos — não consome créditos)', () => {
  it('retorna versão do HUB e tamanho do token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('token-service')) {
          return respostaJson({ access_token: 'TOK', expires_in: 1000 });
        }
        expect(String(url)).toBe('https://hub2.bry.com.br/infos');
        return respostaJson({ version: '3.8.2', rateLimit: '15' });
      })
    );
    const r = await testarConexaoBry(CFG);
    expect(r.versaoHub).toBe('3.8.2');
    expect(r.tokenChars).toBe(3);
  });
});

describe('upgradeCarimboBry (POST /xml/v1/upgrade/signature)', () => {
  const XML_BES = '<doc>sem carimbo</doc>';
  const XML_T = '<doc>com <xades141:EncapsulatedTimeStamp>TOKEN</xades141:EncapsulatedTimeStamp></doc>';

  function mockComToken(respostaUpgrade: () => Promise<Response>) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('token-service')) {
        return respostaJson({ access_token: 'TOK', expires_in: 1000 });
      }
      return respostaUpgrade();
    }));
  }

  it('status 200 + document base64 → XML carimbado e contagem de carimbos', async () => {
    mockComToken(async () =>
      respostaJson([{ status: 200, timestamp: Date.now(), document: Buffer.from(XML_T).toString('base64') }])
    );
    const r = await upgradeCarimboBry(CFG, XML_BES);
    expect(r.xml).toBe(XML_T);
    expect(r.carimbosAdicionados).toBe(1);
  });

  it('usa profile=TIMESTAMP e returnType=BASE64 no multipart', async () => {
    mockComToken(async () =>
      respostaJson([{ status: 200, document: Buffer.from(XML_T).toString('base64') }])
    );
    const espiao = fetch as any;
    await upgradeCarimboBry(CFG, XML_BES);
    const init = espiao.mock.calls.find((c: any[]) => String(c[0]).includes('upgrade'))?.[1] as RequestInit;
    const fd = init.body as unknown as FormData;
    expect(String(fd.get('profile'))).toBe('TIMESTAMP');
    expect(String(fd.get('returnType'))).toBe('BASE64');
    expect(fd.get('signature[0]')).toBeTruthy();
  });

  it('item com status≠200 → erro com chave/message da BRy', async () => {
    mockComToken(async () =>
      respostaJson(
        [{ status: 400, chave: 'excecao.signer.erro', message: 'certificado expirado' }],
        400
      )
    );
    await expect(upgradeCarimboBry(CFG, XML_BES)).rejects.toThrow(/certificado expirado.*\[excecao\.signer\.erro\]|BRy HUB não carimbou/s);
  });

  it('HTTP 401 → renova token (limpa cache) e retenta UMA vez', async () => {
    let tentativas = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('token-service')) {
        return respostaJson({ access_token: 'TOK', expires_in: 1000 });
      }
      tentativas++;
      if (tentativas === 1) return respostaJson({ message: 'jwt expired' }, 401);
      return respostaJson([{ status: 200, document: Buffer.from(XML_T).toString('base64') }]);
    }));
    const r = await upgradeCarimboBry(CFG, XML_BES);
    expect(r.xml).toBe(XML_T);
    expect(tentativas).toBe(2);
  });

  it('timeout → mensagem específica', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw Object.assign(new Error('timed out'), { name: 'AbortError' });
    }));
    await expect(upgradeCarimboBry(CFG, XML_BES, 10)).rejects.toThrow(/timeout|rede/i);
  });
});
