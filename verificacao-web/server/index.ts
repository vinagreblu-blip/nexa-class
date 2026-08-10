// Sentry DEVE ser inicializado antes de qualquer outro import para que
// instrumente módulos como express/http/etc.
import { initSentry } from './sentry';
initSentry({ dsn: process.env.SENTRY_DSN });

import { carregarEnv } from './env';
import { initDb } from './db';
import { createApp } from './app';
import { validarConfigProducao } from './config';
import { logger } from './logger';

carregarEnv();

const PORT = Number(process.env.PORT ?? 3001);
const API_KEY = process.env.API_KEY ?? 'nexa-dev-api-key-trocar';
const INSTITUICAO =
  process.env.INSTITUICAO ?? 'NEXA CLASS - Network for Education and Academic Excellence Class';

// Em produção, recusa iniciar com API key default/ausente/curta.
const erroConfig = validarConfigProducao({ apiKey: API_KEY });
if (erroConfig) {
  logger.error({ motivo: erroConfig }, 'Configuração inválida — abortando boot');
  process.exit(1);
}

initDb().then(() => {
  const app = createApp({ apiKey: API_KEY, instituicao: INSTITUICAO });
  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'Serviço de verificação rodando');
  });
});
