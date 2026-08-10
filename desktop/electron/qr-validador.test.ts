import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock do módulo ./tunnel para isolar gerarUrlValidacao de rede/IP local.
// getBaseUrl é a única função lida por qr-validador.
vi.mock('./tunnel', () => ({
  getBaseUrl: vi.fn(() => 'http://192.168.0.10:3001'),
}));

import { gerarUrlValidacao } from './qr-validador';
import { getBaseUrl } from './tunnel';

describe('gerarUrlValidacao', () => {
  beforeEach(() => {
    vi.mocked(getBaseUrl).mockReturnValue('http://192.168.0.10:3001');
  });

  it('gera URL apontando para /v/:codigo', () => {
    const url = gerarUrlValidacao({ codigo: 'abc-123' });
    expect(url).toBe('http://192.168.0.10:3001/v/abc-123');
  });

  it('aceita o campo legado k como alias de codigo', () => {
    const url = gerarUrlValidacao({ k: 'xyz-789' });
    expect(url).toBe('http://192.168.0.10:3001/v/xyz-789');
  });

  it('lança erro quando código está ausente', () => {
    expect(() => gerarUrlValidacao({})).toThrowError(/código de vericação ausente/i);
    expect(() => gerarUrlValidacao({ codigo: '' })).toThrowError(/código de vericação ausente/i);
  });

  it('prioriza codigo quando ambos codigo e k estão presentes', () => {
    const url = gerarUrlValidacao({ codigo: 'pri', k: 'sec' });
    expect(url).toBe('http://192.168.0.10:3001/v/pri');
  });

  it('URL-encodes códigos com caracteres especiais', () => {
    expect(gerarUrlValidacao({ codigo: 'a b/c' })).toBe(
      'http://192.168.0.10:3001/v/a%20b%2Fc'
    );
  });

  it('remove barra final do base URL', () => {
    vi.mocked(getBaseUrl).mockReturnValue('https://tunnel.pinggy.io/');
    expect(gerarUrlValidacao({ codigo: 'cod' })).toBe('https://tunnel.pinggy.io/v/cod');
  });

  it('remove múltiplas barras finais do base URL', () => {
    vi.mocked(getBaseUrl).mockReturnValue('http://host:3001///');
    expect(gerarUrlValidacao({ codigo: 'cod' })).toBe('http://host:3001/v/cod');
  });
});
