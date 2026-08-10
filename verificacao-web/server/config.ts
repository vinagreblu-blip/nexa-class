/**
 * Constantes e validações de configuração do serviço de verificação web.
 * Separado de env.ts para manter este último focado em parsing de .env.
 */
export const DEFAULT_API_KEY = 'nexa-dev-api-key-trocar';

export interface ProducaoConfig {
  apiKey: string;
  nodeEnv?: string;
}

/**
 * Em produção (NODE_ENV=production) o serviço recusa iniciar com a API key
 * default — obrigatoriamente exige uma key forte setada via env API_KEY.
 *
 * Retorna `null` se OK, ou mensagem de erro se inválido.
 */
export function validarConfigProducao(opts: ProducaoConfig): string | null {
  const nodeEnv = opts.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';
  if (!isProd) return null;

  if (!opts.apiKey) {
    return 'API_KEY ausente em produção. Sete uma key forte via variável de ambiente API_KEY.';
  }
  if (opts.apiKey === DEFAULT_API_KEY) {
    return (
      'API_KEY igual ao default público em produção. Gere uma key forte ' +
      '(ex.: `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"`) ' +
      'e sete via API_KEY. O default é aceito apenas em desenvolvimento.'
    );
  }
  if (opts.apiKey.length < 16) {
    return 'API_KEY curta demais em produção (< 16 chars). Use ao menos 32 bytes aleatórios.';
  }
  return null;
}
