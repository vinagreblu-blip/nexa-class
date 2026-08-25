// ============================================================
// TRADUÇÃO DE ERROS A3 — módulo PURO (sem imports do Electron)
// ============================================================
// Extraído de ipc/assinatura.ts para ser testável em Node puro
// (vitest). O assinatura.ts re-exporta para manter compat com
// pades.ts e demais callers.

/**
 * Traduz mensagens comuns de erro de token A3 para PT-BR, ANEXANDO o erro
 * original (truncado) — sem isso é impossível distinguir diálogo de PIN
 * cancelado, PIN errado, token bloqueado ou falha específica do middleware.
 * A comparação é sem acentos (middlewares em PT-BR emitem "cartão", "bloqueado"…).
 */
export function traduzirErroA3(msg: string): string {
  const m = (msg ?? '').toLowerCase();
  // Normaliza: remove diacríticos ("cartão" → "cartao") para casar middlewares PT-BR.
  const mn = m.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const comOriginal = (traduzido: string): string => {
    const orig = (msg ?? '').trim();
    if (!orig) return traduzido;
    const trunc = orig.length > 200 ? `${orig.slice(0, 200)}…` : orig;
    return `${traduzido} [Erro original: ${trunc}]`;
  };
  // Timeout vem ANTES de tudo: a mensagem de timeout contém "token/PIN" e
  // cairia no ramo genérico de PIN, escondendo a causa real (token ausente,
  // middleware travado ou janela de PIN nunca confirmada).
  if (mn.includes('tempo esgotado') || mn.includes('timed out') || mn.includes('timeout')) {
    return comOriginal(
      'Tempo esgotado aguardando o token responder. Verifique:\n' +
        '1) O token está conectado NESTA máquina? (certificado A3 só assina onde o token está)\n' +
        '2) Procure a janela do PIN na barra de tarefas — ela pode ter aberto atrás do app.\n' +
        '3) Se persistir, o middleware do token pode estar travado: reinicie o computador com o token conectado.'
    );
  }
  // Troca de PIN obrigatória vem ANTES de tudo: "The smart card PIN must be
  // changed" também contém "the smart card" e cairia no ramo de driver.
  if (
    mn.includes('pin must be changed') || mn.includes('pin deve ser alterado') ||
    mn.includes('precisa ser alterado') || mn.includes('alterar o pin') || mn.includes('trocar o pin')
  ) {
    return comOriginal('O token exige a troca do PIN inicial antes de assinar. Abra o utilitário do fabricante (ícone perto do relógio), troque o PIN e tente novamente.');
  }
  if (mn.includes('pin is incorrect') || mn.includes('pin was incorrect') || mn.includes('pin incorreto') || mn.includes('wrong pin')) {
    return comOriginal('PIN incorreto. Verifique o PIN no utilitário do middleware do fabricante (ícone perto do relógio) e tente novamente.');
  }
  // Bloqueio por tentativas erradas (Safenet e afins; PT e EN).
  if (
    mn.includes('bloqueado') || mn.includes('blocked') || mn.includes('blockeado') ||
    mn.includes('tentativas') || mn.includes('attempts') || mn.includes('excedido') || mn.includes('exceeded')
  ) {
    return comOriginal('Token BLOQUEADO após tentativas de PIN erradas (ou PIN expirado). Desbloqueie com o PUK no utilitário do fabricante (ícone perto do relógio). Se não souber o PUK, procure a autoridade certificadora que emitiu o token.');
  }
  if (mn.includes('cancel')) {
    return comOriginal('A janela do PIN não foi confirmada. O diálogo do PIN é aberto pelo driver e pode abrir ATRÁS do app — repita a operação, procure a janela na barra de tarefas e digite o PIN.');
  }
  if (mn.includes('the smart card') || mn.includes('cartao') || mn.includes('card is not supported')) {
    return comOriginal('Token/SmartCard não detectado ou driver não instalado. Conecte o token e instale o middleware do fabricante (Safenet, Pronova, etc.).');
  }
  if (mn.includes('pin')) {
    return comOriginal('Não foi possível autenticar o PIN do token. Conecte o token, repita a operação e informe o PIN quando solicitado.');
  }
  if (mn.includes('chave privada nao acessivel') || mn.includes('nao conseguiu abrir a chave')) {
    return comOriginal('Chave privada do token inacessível: o certificado foi encontrado, mas o driver não abriu a chave. Conecte o token e instale o middleware do fabricante (Safenet, Gemalto, Watchdata…).');
  }
  if (mn.includes('cannot find subitem') || mn.includes('nao encontrado')) {
    return comOriginal('Certificado não encontrado no repositório do Windows. Reimporte o certificado A3.');
  }
  return comOriginal('Erro ao assinar com o token: ' + (msg || 'verifique o token e o driver'));
}

/**
 * Extrai o último marcador de fase (FASE:xxx) emitido pelo script PowerShell
 * antes de travar — revela ONDE a assinatura parou (store, chave, XML,
 * assinando=PIN/hardware) quando o timeout mata o processo.
 */
export function extrairUltimaFase(stdout: string): string | null {
  const fases = (stdout ?? '').match(/FASE:[^\s\r\n]+/g);
  return fases && fases.length > 0 ? fases[fases.length - 1] : null;
}

/** Mensagem de erro de certificado A3 ausente no store DESTA máquina. */
export function erroCertificadoAusente(): string {
  return (
    'Certificado A3 não encontrado nesta máquina. Um certificado de token (A3) só ' +
    'assina no computador onde o token está fisicamente conectado.\n' +
    'Se o token está em outra máquina: o documento deve ser assinado por quem está com o token.\n' +
    'Se o token deveria estar aqui: conecte-o, abra o middleware do fabricante e reimporte o certificado em Assinatura Digital.'
  );
}

/** Mensagem de erro de certificado A3 expirado. */
export function erroCertificadoExpirado(validoAte: string): string {
  return (
    `Certificado A3 EXPIRADO (válido até ${validoAte}). ` +
    'Renove o certificado com a autoridade certificadora (ex.: AC Link/SESCAP) e reimporte em Assinatura Digital.'
  );
}

/**
 * Mensagem de erro de chave privada inacessível no pré-check: o certificado
 * EXISTE no store (ex.: sobrou de quando o token esteve conectado), mas o
 * Windows não consegue abrir a chave — token desconectado nesta máquina ou
 * middleware do fabricante ausente/travado. Sem isso, a assinatura falhava
 * com timeout mudo de 3 minutos.
 */
export function erroChaveInacessivel(): string {
  return (
    'Certificado encontrado, mas a chave privada do token NÃO está acessível nesta máquina.\n' +
    'Conecte o token USB neste computador e tente novamente — um certificado A3 só assina onde o token está conectado.\n' +
    'Se o token já está conectado: verifique se o middleware do fabricante (Safenet, Pronova, Gemalto, Watchdata…) está instalado; ' +
    'se persistir, reinicie o computador com o token conectado.'
  );
}
