import { spawn } from 'node:child_process';
import { getLocalIP } from './network';
import { logger } from './utils/logger';

let tunnelUrl: string | null = null;
let tunnelProcess: any = null;

// Túnel público só é ativado explicitamente. Default: OFF (apenas IP local).
// Motivo: expor o serviço de verificação à internet sem consentimento é perigoso.
// Para habilitar, setar NEXA_ENABLE_TUNNEL=1 no ambiente (e.g. num .env em produção).
const TUNNEL_HABILITADO = process.env.NEXA_ENABLE_TUNNEL === '1';

export async function iniciarTunnel(): Promise<string | null> {
  const localIP = getLocalIP();

  if (TUNNEL_HABILITADO) {
    try {
      const url = await tentarPinggy();
      if (url) {
        tunnelUrl = url;
        logger.info({ url }, 'Túnel público criado');
        return url;
      }
    } catch (e: any) {
      logger.warn({ err: e }, 'Túnel público falhou');
    }
  } else {
    logger.debug('Túnel público DESATIVADO (set NEXA_ENABLE_TUNNEL=1 para habilitar)');
  }

  // Fallback: IP local (mesma rede WiFi)
  tunnelUrl = `http://${localIP}:3001`;
  logger.info({ url: tunnelUrl }, 'Usando IP local (mesma rede WiFi)');
  return tunnelUrl;
}

function tentarPinggy(): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false;
    let output = '';

    try {
      // StrictHostKeyChecking=accept-new: aceita a chave do host na primeira vez
      // e exige verificação nas conexões subsequentes (proteção contra MITM).
      // Não usar =no (desabilita a verificação completamente).
      const proc = spawn('ssh', [
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'ConnectTimeout=10',
        '-o', 'ServerAliveInterval=30',
        '-p', '443',
        '-R0:localhost:3001',
        'a.pinggy.io',
      ], { shell: false });

      const checkUrl = (data: string) => {
        output += data;
        // Pinggy mostra a URL no formato: https://xxxx.pinggy.io
        const match = output.match(/https:\/\/[a-z0-9]+\.pinggy\.io/);
        if (match && !resolved) {
          resolved = true;
          tunnelProcess = proc;
          resolve(match[0]);
        }
      };

      proc.stdout.on('data', (data: Buffer) => checkUrl(data.toString()));
      proc.stderr.on('data', (data: Buffer) => checkUrl(data.toString()));
      proc.on('error', () => { if (!resolved) resolve(null); });
      proc.on('close', () => { if (!resolved) resolve(null); });

      // Timeout de 15 segundos
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { proc.kill(); } catch {}
          resolve(null);
        }
      }, 15000);
    } catch {
      resolve(null);
    }
  });
}

export function getTunnelUrl(): string | null {
  return tunnelUrl;
}

export function getBaseUrl(): string {
  // Prioridade:
  //  1. process.env.VERIFICACAO_BASE_URL — deploy controlado (serviço web público)
  //  2. tunnelUrl (pinggy) — se túnel explícito ativo
  //  3. IP local — fallback (funciona só na mesma rede WiFi)
  const fromEnv = process.env.VERIFICACAO_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (tunnelUrl && tunnelUrl.startsWith('https://')) return tunnelUrl;
  return `http://${getLocalIP()}:3001`;
}

export function fecharTunnel(): void {
  if (tunnelProcess) {
    try { tunnelProcess.kill(); } catch {}
    tunnelProcess = null;
  }
}
